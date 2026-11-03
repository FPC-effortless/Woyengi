"""Read-only adapter for original LANGDEPTH106 source-published results.

Does not download artifacts, validate checkpoint bytes, or attest original runs.
It preserves upstream identities and refuses to improvise missing FLOP counts,
evaluation target hashes, or independent verification.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from wil_rbs import ContractError, require, validate

RESULTS_URL = ('https://github.com/FPC-effortless/TAC-OSM/blob/'
               'research/langdepth106-tinyshakespeare-1m-2026-10-31/'
               'research/langdepth106_results/RESULT.json')
PROTOCOL_URL = ('https://github.com/FPC-effortless/TAC-OSM/blob/'
                'research/langdepth106-tinyshakespeare-1m-2026-10-31/'
                'research/langdepth106/PROTOCOL.json')


def canonical_sha(x: object) -> str:
    return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',', ':')).encode()).hexdigest()


def imported_evidence() -> dict:
    return {'level':'reported', 'refs':[RESULTS_URL, PROTOCOL_URL],
            'source_note':'Source-reported original receipts, not independently fetched artifact bytes'}


def import_langdepth106(protocol: dict, results: dict, *, protocol_bytes: bytes | None = None,
                        results_bytes: bytes | None = None) -> dict:
    require(protocol.get('study_id') == results.get('study_id') == 'LANGDEPTH106', 'wrong source study')
    require(protocol.get('independent_attestation') is False and results.get('independent_attestation') is False,
            'unexpected upstream attestation status: review source before importing')
    require(protocol.get('fit',{}).get('steps') == 4096, 'unexpected frozen update budget')
    require(results.get('all_six_final_checkpoint_audit') == 'PASS', 'original cohort audit not PASS')
    require(len(results.get('runs',[])) == 6, 'expected six original fit records')
    require(results.get('source_sha256') == protocol.get('source',{}).get('canonical_sha256'),
            'upstream dataset identity differs from protocol')
    source_digest = results.get('protocol_sha256')
    require(isinstance(source_digest,str) and len(source_digest)==64, 'missing original protocol digest')
    # Preserve the source-published digest, not an unverified claim that a parsed
    # JSON representation is byte-for-byte identical to its publisher's artifact.
    records=[]
    seen=set()
    fit=protocol['fit']
    source=protocol['source']
    for raw in results['runs']:
        arm,seed=raw['arm'],raw['seed']
        require(arm in ('four','eight') and seed in protocol['seeds'], 'unexpected arm/seed')
        require((arm,seed) not in seen, 'duplicate source arm/seed')
        seen.add((arm,seed))
        r=raw['training_receipt']
        audit=raw['checkpoint_integrity']
        require(r['actual_steps']==fit['steps']==audit['actual_steps'], 'source step mismatch')
        require(r['checkpoint_sha256']==audit['checkpoint_sha256'], 'checkpoint receipt mismatch')
        require(r['parameter_count']==protocol['models'][arm]['parameters']==audit['parameter_count'], 'parameter count mismatch')
        require(r['sample_offset_sha256']==audit['sample_offset_sha256'], 'sample-order mismatch')
        require(r['training_byte_presentations']==fit['total_predicted_training_bytes_per_fit'], 'training exposure mismatch')
        require(r['train_sha256']==source['splits']['TRAIN']['sha256'], 'train split digest mismatch')
        require(r['optimizer_metadata']['optimizer']==fit['optimizer'], 'optimizer identity differs from registered recipe')
        require(r['scheduler_metadata']['steps']==fit['steps'], 'scheduler length differs from frozen steps')
        require(r['full_training_flops']=='NOT_MEASURED', 'unexpected FLOP evidence; review adapter before importing')
        require(r['independently_qualified'] is False, 'unexpected qualification status; review adapter')
        run_id=f'langdepth106-{arm}-seed{seed}'
        actual_config=r['config']
        require(actual_config == protocol['models'][arm]['config'], 'source model config mismatch')
        checkpoint_entries=r['checkpoints']
        require(len(checkpoint_entries)==len(fit['save_checkpoints_at']), 'checkpoint count mismatch')
        run={
            'kind':'run','id':run_id,'project_id':'TAC-OSM','study_id':'LANGDEPTH106',
            'arm_id':f'tac106-{arm}','seed':seed,
            'source_commit':protocol['implementation']['source_commit'],
            'checkpoint_sha256':r['checkpoint_sha256'],
            'model':{'family':f'TAC106 {arm} layers','trainable_parameters':r['parameter_count'],
                     'deployed_parameters':r['parameter_count'],'config_sha256':canonical_sha(actual_config),
                     'architecture_config':actual_config},
            'data':{'dataset_id':'TinyShakespeare','dataset_sha256':source['canonical_sha256'],
                    'train_split_sha256':source['splits']['TRAIN']['sha256'],
                    'sample_order_sha256':r['sample_offset_sha256'],
                    'target_contract_sha256':None,'tokenizer_sha256':None,'preprocessing_sha256':None,
                    'target_unit':'byte','train_exposure_units':r['training_byte_presentations'],
                    'context_length':fit['sequence_length']},
            'training':{'optimizer':fit['optimizer'],'updates':r['actual_steps'],
                        'batch_size':fit['batch_size'],'sequence_length':fit['sequence_length'],
                        'optimizer_metadata':r['optimizer_metadata'],
                        'scheduler_metadata':r['scheduler_metadata'],
                        'first_fit_loss':r['first_fit_loss'],'last_fit_loss':r['last_fit_loss'],
                        'optimizer_contract_sha256':None,'tuning_policy_sha256':None,
                        'selection_policy_sha256':None},
            'resources':{'wall_seconds':r['wall_seconds'],'flop_budget':None,
                         'training_flops':{'method':'unavailable','value':None},
                         'persistent_state_bytes':raw['cpu_inference_resource_fixture']['persistent_logical_tensor_bytes']},
            'original_receipts':{'result_source_sha256':results['source_sha256'],
                                 'protocol_source_sha256':source_digest,
                                 'source_receipt_sha256':r['source_receipt_sha256'],
                                 'implementation_sha256':r['implementation_sha256'],
                                 'python_version':r['python_version'],'torch_version':r['torch_version'],
                                 'cpu_threads':r['cpu_threads'],'hardware':r['hardware'],
                                 'process_cpu_seconds':r['process_cpu_seconds'],
                                 'peak_rss_bytes':r['peak_rss_bytes']},
            'evidence':imported_evidence()
        }
        records.append(run)
        for cp in checkpoint_entries:
            require(cp['step'] in fit['save_checkpoints_at'], 'unexpected checkpoint step')
            records.append({
                'kind':'checkpoint','id':f'{run_id}-step{cp["step"]}',
                'project_id':'TAC-OSM','study_id':'LANGDEPTH106',
                'run_id':run_id,'step':cp['step'],'checkpoint_sha256':cp['sha256'],
                'artifact_name':cp['file'],'evidence':imported_evidence()})
        for partition in ('dev','test'):
            for mode in ('reset_windows','continuous_carry'):
                measured=raw['metrics'][partition][mode]
                require(measured['target_count']==source['splits'][partition.upper()]['bytes']-1,
                        'source target count inconsistent with split')
                for measure,unit,direction,source_key in (
                    ('nll','nat/byte','min','next_byte_nll_nats'),
                    ('next_byte_accuracy','ratio','max','next_byte_accuracy'),
                ):
                    metric_id=f'{run_id}-{partition}-{mode}-{measure}'
                    records.append({
                        'kind':'evaluation','id':metric_id,'project_id':'TAC-OSM','study_id':'LANGDEPTH106',
                        'run_id':run_id,'checkpoint_id':f'{run_id}-step{fit["steps"]}',
                        'checkpoint_sha256':r['checkpoint_sha256'],
                        'metric':{'name':measure,'unit':unit,'direction':direction,'split':partition,
                                  'protocol_mode':mode,'value':measured[source_key],
                                  'target_count':measured['target_count'],
                                  'target_sha256':None,'evaluator_sha256':None},
                        'evidence':imported_evidence()})
    require(len(seen)==6,'missing one of six source fits')
    # Cross-check published means, without pretending that this is replay of
    # the original evaluator or evidence that the raw checkpoint bytes were read.
    summary=results.get('paired_summary',{}).get('test/reset_windows',{})
    by_arm={a:[x for x in results['runs'] if x['arm']==a] for a in ('four','eight')}
    differences={x['seed']:x['metrics']['test']['reset_windows']['next_byte_nll_nats'] for x in by_arm['eight']}
    diff=sum(differences[x['seed']]-x['metrics']['test']['reset_windows']['next_byte_nll_nats'] for x in by_arm['four'])/3
    require(abs(diff-summary['mean_nll_eight_minus_four'])<1e-10, 'original published aggregate not reproduced')
    output={'schema':'wil-rbs.v1','records':records,
            'import_metadata':{'source_format':'LANGDEPTH106 original RESULT.json / PROTOCOL.json',
              'result_bytes_sha256':hashlib.sha256(results_bytes).hexdigest() if results_bytes else None,
              'protocol_bytes_sha256':hashlib.sha256(protocol_bytes).hexdigest() if protocol_bytes else None,
              'original_protocol_sha256':source_digest,
              'status':'REPORTED_ORIGINAL_ARTIFACTS_NOT_INDEPENDENTLY_REVERIFIED'}}
    validate(output)
    return output


def main(argv: list[str] | None = None) -> int:
    p=argparse.ArgumentParser(description='Import original frozen LANGDEPTH106 per-seed receipts')
    p.add_argument('protocol',type=Path)
    p.add_argument('results',type=Path)
    p.add_argument('--output',required=True,type=Path)
    a=p.parse_args(argv)
    try:
        pb=a.protocol.read_bytes()
        rb=a.results.read_bytes()
        o=import_langdepth106(json.loads(pb),json.loads(rb),protocol_bytes=pb,results_bytes=rb)
        a.output.write_text(json.dumps(o,indent=2,sort_keys=True)+'\n',encoding='utf-8')
        print(json.dumps({'status':'IMPORTED','runs':6,'checkpoints':30,'evaluations':48,
                          'evidence':'REPORTED_ONLY','output':str(a.output)}))
        return 0
    except (OSError,KeyError,TypeError,ValueError,ContractError) as exc:
        print(json.dumps({'status':'INVALID','error':str(exc)}))
        return 2

if __name__=='__main__':
    raise SystemExit(main())
