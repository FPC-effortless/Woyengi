"""Cross-study WIL-RBS catalog. Missing provenance never becomes a model leaderboard."""
from __future__ import annotations
import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path
from wil_rbs import ContractError, require, validate

COSTS={
    'training_wall_seconds':'s','training_flops':'FLOPs',
    'trainable_parameters':'parameters','deployed_parameters':'parameters',
    'persistent_state_bytes':'bytes','cached_decode_ms_per_unit':'ms/unit',
}

def _metric_key(m):
    return (m['name'],m['unit'],m['split'],m['direction'],m.get('protocol_mode'),
            m.get('target_count'),m.get('target_sha256'),m.get('evaluator_sha256'))

def _identity(r,m):
    d=r['data']
    return (d.get('dataset_sha256'),d.get('train_split_sha256'),
            d.get('target_contract_sha256'),d.get('tokenizer_sha256'),
            d.get('preprocessing_sha256'),d['target_unit'],d['context_length'],
            *_metric_key(m))

def _runtime(r,cost):
    if cost=='training_wall_seconds':
        p=r.get('runtime') or {}
        keys=('hardware_id','software_sha256','precision','cpu_threads')
    elif cost=='cached_decode_ms_per_unit':
        p=r['resources'].get('inference_profile') or {}
        if not p.get('cache_parity_verified'): return None
        keys=('workload_sha256','software_sha256','hardware_id','precision',
              'unit','mode','batch_size')
    else:
        return ()
    return tuple(p[k] for k in keys) if all(p.get(k) is not None for k in keys) else None

def _cost(r,cost):
    if cost=='training_wall_seconds':return r['resources'].get('wall_seconds')
    if cost=='training_flops':
        f=r['resources']['training_flops']
        if f.get('scope')!='end_to_end_training' or f.get('method') not in ('operator_census','measured_profiler'):
            return None
        return f.get('value')
    if cost in ('trainable_parameters','deployed_parameters'):return r['model'][cost]
    if cost=='persistent_state_bytes':return r['resources'].get('persistent_state_bytes')
    p=r['resources'].get('inference_profile')
    return p.get('decode_ms_per_unit') if p and p.get('cache_parity_verified') else None

def catalog(data,*,metric='nll',split='test',mode='reset_windows',
            cost='training_wall_seconds',include_historical=True):
    validate(data)
    require(cost in COSTS,f'unsupported cost dimension {cost}')
    runs={r['id']:r for r in data['records'] if r['kind']=='run'}
    groups=defaultdict(list)
    for e in data['records']:
        if e['kind']=='evaluation':
            m=e['metric']
            if (m['name'],m['split'],m.get('protocol_mode'))!=(metric,split,mode):continue
            r=runs[e['run_id']]
            groups[(r['project_id'],r['study_id'],r['arm_id'],'run')].append(
                (r,m,e['id'],r['seed'],e['evidence']['level']))
        elif e['kind']=='historical_aggregate' and include_historical:
            m=e['metric']
            if m['name']!=metric or m['split']!=split:continue
            if m.get('protocol_mode') not in (None,mode):continue
            groups[(e['project_id'],e['study_id'],e['id'],'historical_aggregate')].append(
                (e,m,e['id'],None,e['evidence']['level']))
    rows=[]
    for (project,study,arm,kind),items in sorted(groups.items()):
        identities={_identity(r,m) for r,m,_,_,_ in items}
        require(len(identities)==1,f'inconsistent dataset/scorer within arm {arm}')
        ident=next(iter(identities))
        seeds=[seed for _,_,_,seed,_ in items if seed is not None]
        require(len(seeds)==len(set(seeds)),f'duplicate seed for {arm}')
        require(kind!='historical_aggregate' or len(items)==1,'duplicate historical aggregate')
        values=[m['value'] for _,m,_,_,_ in items]
        costs=[_cost(r,cost) for r,_,_,_,_ in items]
        complete_cost=all(x is not None for x in costs)
        runtimes={_runtime(r,cost) for r,_,_,_,_ in items}
        runtime=next(iter(runtimes)) if len(runtimes)==1 else None
        rows.append({
            'project_id':project,'study_id':study,'arm_id':arm,'record_kind':kind,
            'model_family':items[0][0]['model']['family'],
            'seed_count':len(seeds) if kind=='run' else items[0][0]['seed_count'],
            'seeds':sorted(seeds) if seeds else None,
            'mean_quality':statistics.fmean(values),
            'sd_quality':statistics.stdev(values) if len(values)>1 else None,
            'mean_cost':statistics.fmean(costs) if complete_cost else None,
            'sd_cost':statistics.stdev(costs) if complete_cost and len(costs)>1 else None,
            'quality_unit':items[0][1]['unit'],'direction':items[0][1]['direction'],
            'cost_unit':COSTS[cost],'source_protocol_mode':items[0][1].get('protocol_mode'),
            'trainable_parameters':items[0][0]['model']['trainable_parameters'],
            'deployed_parameters':items[0][0]['model']['deployed_parameters'],
            'evidence_levels':sorted(set(x[-1] for x in items)),
            'source_ids':sorted(x[2] for x in items),
            'source_contract_complete':all(v is not None for v in ident),
            'runtime_contract_complete':runtime is not None,
            'training_flops_authenticated':False,
            'comparison_eligibility':'UNVERIFIED_EXPLORATORY',
            'descriptive_pareto':None,'_identity':ident,'_runtime':runtime,
        })
    candidates=defaultdict(list)
    for row in rows:
        if (row['record_kind']!='run' or not row['source_contract_complete']
            or row['mean_cost'] is None or row['_runtime'] is None
            or cost=='training_flops'):
            continue
        candidates[(row['_identity'],row['_runtime'])].append(row)
    cohorts=[]
    for cand in candidates.values():
        if len(cand)<2:continue
        cohort_id=f'cohort-{len(cohorts)+1}'
        for a in cand:
            dominating=[]
            for b in cand:
                if a is b:continue
                direction=a['direction']
                at_least=(b['mean_quality']<=a['mean_quality'] if direction=='min'
                          else b['mean_quality']>=a['mean_quality'])
                strict=(b['mean_quality']<a['mean_quality'] if direction=='min'
                        else b['mean_quality']>a['mean_quality'])
                if at_least and b['mean_cost']<=a['mean_cost'] and (strict or b['mean_cost']<a['mean_cost']):
                    dominating.append(b['arm_id'])
            a['comparison_eligibility']='MATCHED_MEASUREMENT_CONTRACT_DESCRIPTIVE_ONLY'
            a['descriptive_pareto']=not bool(dominating)
            a['dominated_by']=sorted(dominating)
            a['comparison_cohort_id']=cohort_id
        cohorts.append({'id':cohort_id,'members':sorted(x['arm_id'] for x in cand),
                        'scientific_superiority_authorized':False,
                        'statistical_qualification':'NOT_ASSESSED'})
    for r in rows:r.pop('_identity');r.pop('_runtime')
    return {'status':'EXPLORATORY_CATALOG','metric':metric,'split':split,'mode':mode,
            'cost':cost,'cost_unit':COSTS[cost],'record_count':len(rows),
            'comparability_group_count':len(cohorts),'comparison_cohorts':cohorts,
            'models':rows,'missing_source_contracts_prevent_ranking':
            sum(not x['source_contract_complete'] for x in rows),'science_qualified':False,
            'limitations':['No scientific superiority claim follows from this catalog.',
                           'Missing target/evaluator hashes prevent cross-study ranking.',
                           'Wall time needs identical hardware/software/precision.',
                           'Training FLOP declarations require independent operator auditing.']}

def main(argv=None):
    p=argparse.ArgumentParser(description='WIL-RBS cross-study evidence catalog')
    p.add_argument('manifest',type=Path)
    p.add_argument('--metric',default='nll')
    p.add_argument('--split',default='test')
    p.add_argument('--mode',default='reset_windows')
    p.add_argument('--cost',choices=sorted(COSTS),default='training_wall_seconds')
    p.add_argument('--no-history',action='store_true')
    p.add_argument('--output',type=Path)
    a=p.parse_args(argv)
    try:
        out=catalog(json.loads(a.manifest.read_bytes()),metric=a.metric,split=a.split,
                    mode=a.mode,cost=a.cost,include_historical=not a.no_history)
        msg=json.dumps(out,indent=2,sort_keys=True,allow_nan=False)+'\n'
        if a.output:
            a.output.parent.mkdir(parents=True,exist_ok=True)
            a.output.write_text(msg,encoding='utf-8')
        else:print(msg,end='')
        return 0
    except (OSError,ValueError,TypeError,KeyError,ContractError) as exc:
        print(json.dumps({'status':'INVALID','error':str(exc)}))
        return 2

if __name__=='__main__':raise SystemExit(main())
