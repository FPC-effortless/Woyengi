"""Post-hoc paired across-study analysis with conservative claim status.

An exact per-seed fit sample-order match is a useful source-backed fact, but
cannot substitute for preregistered tuning parity, independently verified TEST
scorer identity, equal training FLOPs, or an architecture-superiority gate.
"""
from __future__ import annotations
import argparse
import json
import statistics
from pathlib import Path
from wil_rbs import ContractError, require, validate


def paired_language(tac:dict, transformer:dict, *, metric:str='nll',split:str='test',mode:str='reset_windows')->dict:
    validate(tac);validate(transformer)
    require(metric in {'nll','next_byte_accuracy'},'unsupported paired metric')
    require(split in {'dev','test'} and mode in {'reset_windows','continuous_carry'},'unsupported evaluation path')

    def select(manifest:dict,study:str,arm:str):
        rows={r['id']:r for r in manifest['records'] if r['kind']=='run' and r['study_id']==study and r['arm_id']==arm}
        scores={}
        for e in manifest['records']:
            if e['kind']!='evaluation' or e['run_id'] not in rows:continue
            m=e['metric']
            if (m['name'],m['split'],m.get('protocol_mode'))==(metric,split,mode):
                run=rows[e['run_id']];seed=run['seed']
                require(seed not in scores,'duplicate metric evaluation for one seed')
                scores[seed]=(run,e)
        require(set(scores)=={10601,10602,10603},'expected original three seeds')
        return scores

    a=select(tac,'LANGDEPTH106','tac106-four')
    b=select(transformer,'LANGBASE107','transformer107-four')
    items=[]
    for seed in sorted(a):
        ar,ae=a[seed];br,be=b[seed]
        ad,bd=ar['data'],br['data']
        for key in ('dataset_sha256','train_split_sha256','sample_order_sha256'):
            require(ad.get(key) is not None and ad.get(key)==bd.get(key),f'seed {seed}: source-matched training {key} not established')
        for key in ('train_exposure_units','context_length','target_unit'):
            require(ad.get(key)==bd.get(key),f'seed {seed}: unequal {key}')
        am,bm=ae['metric'],be['metric']
        for key in ('name','unit','direction','split','target_count'):
            require(am.get(key)==bm.get(key),f'seed {seed}: incompatible evaluator {key}')
        require(am.get('protocol_mode')==bm.get('protocol_mode'),'evaluation mode differs')
        ta,tb=ar['resources'].get('wall_seconds'),br['resources'].get('wall_seconds')
        require(ta is not None and tb is not None and ta>0 and tb>0, 'original per-seed training wall receipts absent')
        items.append({'seed':seed,'tac_quality':am['value'],'transformer_quality':bm['value'],
                      'transformer_minus_tac':bm['value']-am['value'],
                      'tac_wall_seconds':ta,'transformer_wall_seconds':tb,
                      'tac_parameters':ar['model']['trainable_parameters'],
                      'transformer_parameters':br['model']['trainable_parameters'],
                      'tac_state_bytes':ar['resources'].get('persistent_state_bytes'),
                      'transformer_state_bytes':br['resources'].get('persistent_state_bytes'),
                      'matching_train_sample_offset_sha256':ad['sample_order_sha256']})
    vals=[r['transformer_minus_tac'] for r in items]
    tac_time=statistics.fmean(r['tac_wall_seconds'] for r in items)
    transformer_time=statistics.fmean(r['transformer_wall_seconds'] for r in items)
    return {'status':'POST_HOC_PAIRED_EXPLORATORY',
            'metric':metric,'split':split,'mode':mode,'unit':ae['metric']['unit'],
            'seeds':[r['seed'] for r in items],
            'matched_dataset_split_and_exposure':True,
            'matched_per_seed_training_sample_order':True,
            'evaluation_target_and_scorer_hashes_verified':False,
            'training_flops_equal_or_verified':False,
            'training_hardware_equivalence_verified':False,
            'scientific_superiority_authorized':False,
            'mean_transformer_minus_tac_quality':statistics.fmean(vals),
            'sample_sd_paired_difference':statistics.stdev(vals),
            'mean_tac_training_wall_seconds':tac_time,
            'mean_transformer_training_wall_seconds':transformer_time,
            'descriptive_tac_to_transformer_time_ratio':tac_time/transformer_time,
            'limitations':['The Transformer control was registered after the TAC TEST result was known.',
                           'A matching original data and sample order does not establish equal FLOPs, full tuning parity, or independent scorer identity.',
                           'Archive SHA checks recover source bytes but do not rerun original training or evaluation.'],
            'paired_runs':items}


def main(argv:list[str]|None=None)->int:
    p=argparse.ArgumentParser(description='Compare genuine original paired seed receipts without a superiority claim')
    p.add_argument('tac_manifest',type=Path);p.add_argument('transformer_manifest',type=Path)
    p.add_argument('--metric',default='nll',choices=['nll','next_byte_accuracy'])
    p.add_argument('--split',default='test',choices=['dev','test'])
    p.add_argument('--mode',default='reset_windows',choices=['reset_windows','continuous_carry'])
    a=p.parse_args(argv)
    try:
        t=json.loads(a.tac_manifest.read_text());x=json.loads(a.transformer_manifest.read_text())
        result=paired_language(t,x,metric=a.metric,split=a.split,mode=a.mode)
        print(json.dumps(result,indent=2,sort_keys=True,allow_nan=False));return 0
    except (OSError,ValueError,TypeError,KeyError,ContractError) as exc:
        print(json.dumps({'status':'INVALID','error':str(exc)}));return 2

if __name__=='__main__':raise SystemExit(main())
