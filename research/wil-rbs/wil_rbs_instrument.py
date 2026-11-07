"""Opt-in WIL-RBS stage timing; never certifies full training FLOPs."""
from __future__ import annotations
from contextlib import contextmanager
import hashlib
import json
import statistics
import time
from typing import Callable, Iterator
from wil_rbs import ContractError, require

STAGES=('data','forward','backward','optimizer','other')

def _canonical(x):
    return json.dumps(x,sort_keys=True,separators=(',',':'),allow_nan=False).encode('utf8')

class TrainingStepMeter:
    """Records attempted, completed and failed training steps without executing them."""
    def __init__(self,*,run_id:str,device_type:str='cpu',hardware_id:str,
                 precision:str,source_commit:str|None=None,
                 synchronization:Callable[[],None]|None=None,
                 clock:Callable[[],int]=time.perf_counter_ns):
        require(isinstance(run_id,str) and bool(run_id.strip()),'run_id required')
        require(isinstance(hardware_id,str) and bool(hardware_id.strip()),'hardware_id required')
        require(isinstance(precision,str) and bool(precision.strip()),'precision required')
        require(device_type in {'cpu','cuda','mps','other'},'unknown device_type')
        require(device_type=='cpu' or synchronization is not None,
                'accelerator timing requires explicit synchronization callback')
        if source_commit is not None:
            require(isinstance(source_commit,str) and len(source_commit)==40 and
                    all(c in '0123456789abcdef' for c in source_commit),
                    'source_commit must be SHA-1')
        self.run_id,self.device_type,self.hardware_id=run_id,device_type,hardware_id
        self.precision,self.source_commit=precision,source_commit
        self.synchronization,self.clock=synchronization,clock
        self.events=[];self._active=None;self._stage=None

    def _now(self)->int:
        if self.synchronization:self.synchronization()
        result=self.clock()
        require(type(result) is int and result>=0,'invalid monotonic clock')
        return result

    @contextmanager
    def step(self,index:int)->Iterator[None]:
        require(type(index) is int and index>=0,'step index must be nonnegative integer')
        require(self._active is None,'nested or overlapping step')
        require(not self.events or index>self.events[-1]['step_index'],
                'step indices must strictly increase')
        start=self._now()
        self._active={'step_index':index,'stages_ns':{},'status':'RUNNING'}
        try:
            yield
        except BaseException as exc:
            self._finish(start,'FAILED',type(exc).__name__)
            raise
        else:
            if self._stage is not None:
                self._finish(start,'FAILED','UnclosedStage')
                raise ContractError('stage context was not closed')
            self._finish(start,'COMPLETED',None)

    @contextmanager
    def stage(self,name:str)->Iterator[None]:
        require(name in STAGES,f'unsupported timing stage {name!r}')
        require(self._active is not None,'stage must be within step')
        require(self._stage is None,'overlapping/nested stage')
        start=self._now();self._stage=name
        try:
            yield
        finally:
            end=self._now()
            self._active['stages_ns'][name]=self._active['stages_ns'].get(name,0)+max(0,end-start)
            self._stage=None

    def _finish(self,start:int,status:str,error:str|None):
        end=self._now()
        event=self._active
        event.update(status=status,error_type=error,total_wall_ns=max(0,end-start))
        event['stage_coverage_complete']=bool(status=='COMPLETED' and
            all(s in event['stages_ns'] for s in ('forward','backward','optimizer')))
        self.events.append(event);self._stage=None;self._active=None

    def receipt(self)->dict:
        require(self._active is None,'cannot issue receipt during an active step')
        require(bool(self.events),'at least one attempted step required')
        completed=[e for e in self.events if e['status']=='COMPLETED']
        out={'schema':'wil-rbs.training-timing.v1','run_id':self.run_id,
             'device_type':self.device_type,'hardware_id':self.hardware_id,
             'precision':self.precision,'source_commit':self.source_commit,
             'clock':'perf_counter_ns' if self.clock is time.perf_counter_ns else 'injected_monotonic_ns',
             'accelerator_synchronized':self.synchronization is not None,
             'attempted_updates':len(self.events),'completed_updates':len(completed),
             'failed_updates':len(self.events)-len(completed),
             'mean_completed_wall_seconds':
                 statistics.fmean(e['total_wall_ns'] for e in completed)/1e9 if completed else None,
             'stage_coverage_complete':bool(completed) and all(e['stage_coverage_complete'] for e in completed),
             'training_flops':None,'full_training_flops_certified':False,
             'timestamps_and_operator_coverage_not_independently_verified':True,
             'events':self.events}
        out['record_sha256']=hashlib.sha256(_canonical(out)).hexdigest()
        return out

def verify_receipt(receipt:dict)->dict:
    require(isinstance(receipt,dict) and receipt.get('schema')=='wil-rbs.training-timing.v1',
            'wrong timing receipt schema')
    claimed=receipt.get('record_sha256')
    require(isinstance(claimed,str) and len(claimed)==64,'missing integrity digest')
    require(hashlib.sha256(_canonical({k:v for k,v in receipt.items() if k!='record_sha256'})).hexdigest()==claimed,
            'timing receipt modified after recording')
    require(receipt.get('full_training_flops_certified') is False and receipt.get('training_flops') is None,
            'timer cannot certify training FLOPs')
    events=receipt.get('events')
    require(isinstance(events,list) and len(events)==receipt.get('attempted_updates') and bool(events),
            'event count mismatch')
    require(all(type(e.get('step_index')) is int for e in events)
            and all(a['step_index']<b['step_index'] for a,b in zip(events,events[1:])),
            'nonmonotonic step indices')
    return {'status':'RECEIPT_INTEGRITY_CHECKED','run_id':receipt['run_id'],
            'attempted_updates':len(events),'completed_updates':receipt['completed_updates'],
            'training_flops':None,'independent_measurement_authenticity':False}

def profile_torch_forward(fn:Callable[[],object],*,run_id:str)->dict:
    """Partial CPU torch profiler census. Does not profile a training run."""
    require(callable(fn),'callable required')
    require(isinstance(run_id,str) and bool(run_id.strip()),'run_id required')
    try:
        import torch
    except ImportError as exc:
        raise ContractError('PyTorch not installed; optional profiler unavailable') from exc
    with torch.profiler.profile(activities=[torch.profiler.ProfilerActivity.CPU],
                                with_flops=True,record_shapes=True) as prof:
        fn()
    ops=[{'operator':e.key,'reported_flops':int(e.flops or 0),'calls':e.count}
         for e in prof.key_averages() if (e.flops or 0)>0]
    return {'schema':'wil-rbs.torch-forward-census.v1','run_id':run_id,
            'torch_version':torch.__version__,'device':'cpu',
            'observed_operator_flops':sum(e['reported_flops'] for e in ops),
            'operators':sorted(ops,key=lambda x:x['operator']),
            'training_flops':None,'complete_operator_coverage_verified':False,
            'backward_optimizer_communication_included':False,
            'scientific_superiority_authorized':False,
            'warning':'Profiler with_flops counts supported operators only; omitted work is unknown.'}
