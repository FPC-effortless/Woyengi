"""Explicitly exploratory Pareto reports from comparable, source-reported runs.

This is *not* an experimental superiority ranking or research qualification.
Only complete, like-for-like metric contracts are considered within one study.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path

from wil_rbs import ContractError, require, validate

COSTS = {'training_wall_seconds', 'trainable_parameters', 'deployed_parameters',
         'persistent_state_bytes', 'training_flops'}


def _cost(run: dict, field: str) -> float | None:
    if field == 'training_wall_seconds':
        return run['resources'].get('wall_seconds')
    if field == 'training_flops':
        f = run['resources']['training_flops']
        # Pure analytical estimates and partial census never enter a measured
        # quality-per-FLOP frontier, even when both have numerical values.
        return f.get('value') if f.get('scope') == 'end_to_end_training' and f.get('method') in ('operator_census','measured_profiler') else None
    if field in ('trainable_parameters', 'deployed_parameters'):
        return run['model'][field]
    return run['resources'].get('persistent_state_bytes')


def frontier(data: dict, *, study: str, metric: str = 'nll', split: str = 'test',
             mode: str = 'reset_windows', cost: str = 'training_wall_seconds') -> dict:
    validate(data)
    require(cost in COSTS, f'unsupported cost dimension {cost}')
    runs={r['id']:r for r in data['records'] if r['kind']=='run' and r['study_id']==study}
    evs=[r for r in data['records'] if r['kind']=='evaluation' and r['study_id']==study and
         r['metric']['name']==metric and r['metric']['split']==split and
         r['metric'].get('protocol_mode')==mode]
    require(evs, 'no matching evaluations for study/metric/split/mode')
    groups=defaultdict(list)
    for e in evs:
        run=runs[e['run_id']]
        groups[run['arm_id']].append((run,e))
    reports=[]
    signatures=set()
    for arm in sorted(groups):
        rows=groups[arm]
        seeds=[r['seed'] for r,_ in rows]
        require(len(seeds)==len(set(seeds)),f'arm {arm} has repeated seed evaluations')
        values=[e['metric']['value'] for _,e in rows]
        costs=[_cost(r,cost) for r,_ in rows]
        ma=rows[0][1]['metric']
        # A group with mixed targets or evaluators must not be silently averaged.
        signature=lambda m:(m['name'],m['unit'],m['split'],m['direction'],m.get('protocol_mode'),
                             m['target_count'],m.get('target_sha256'),m.get('evaluator_sha256'))
        require(all(signature(e['metric'])==signature(ma) for _,e in rows),
                f'arm {arm}: inconsistent evaluator targets across seeds')
        signatures.add(signature(ma))
        data_signature=lambda r:(r['data']['dataset_id'],r['data'].get('dataset_sha256'),
                                 r['data']['target_unit'],r['data']['context_length'])
        require(len({data_signature(r) for r,_ in rows})==1, f'arm {arm}: mixed data contracts')
        require(all(x is not None for x in costs) or all(x is None for x in costs),
                f'arm {arm}: partially missing {cost} measurements; must not silently average')
        reports.append({'arm_id':arm,'seeds':sorted(seeds), 'run_count':len(seeds),
                        'mean_quality':statistics.fmean(values),
                        'sd_quality':statistics.stdev(values) if len(values)>1 else None,
                        'mean_cost':statistics.fmean(costs) if costs[0] is not None else None,
                        'sd_cost':statistics.stdev(costs) if costs[0] is not None and len(costs)>1 else None,
                        'metric_unit':ma['unit'],'evidence_levels':sorted({e['evidence']['level'] for _,e in rows}),
                        'source_run_ids':sorted(r['id'] for r,_ in rows)})
    require(len(signatures)==1, 'incomparable evaluator metrics/targets across architecture arms')
    # Missing evaluator and target digests make this a descriptive report, even
    # if the original study claims matching target windows in its documentation.
    one=next(iter(signatures))
    target_identity_verified=one[6] is not None and one[7] is not None
    paired_seed_sets=len({tuple(r['seeds']) for r in reports})==1
    cost_complete=all(r['mean_cost'] is not None for r in reports)
    direction=one[3]
    for r in reports:
        r['descriptive_pareto'] = None
        r['dominated_by'] = []
    if cost_complete:
        for r in reports:
            dominated=[]
            for q in reports:
                if r is q: continue
                quality_le=(q['mean_quality']<=r['mean_quality'] if direction=='min' else
                            q['mean_quality']>=r['mean_quality'])
                strictly_better=q['mean_quality']!=r['mean_quality'] or q['mean_cost']!=r['mean_cost']
                if q['mean_cost']<=r['mean_cost'] and quality_le and strictly_better:
                    dominated.append(q['arm_id'])
            r['dominated_by']=sorted(dominated)
            r['descriptive_pareto']=not bool(dominated)
    return {'status':'EXPLORATORY_ONLY', 'study_id':study,'metric':metric,'metric_unit':one[1],
            'split':split,'mode':mode,'cost_dimension':cost,
            'comparable_metric_shape':True,'complete_cost_measurements':cost_complete,
            'target_and_evaluator_hashes_present':target_identity_verified,
            'paired_seed_sets':paired_seed_sets,
            'scientific_superiority_authorized':False,
            'notes':['Reported-run summaries only; original model/checkpoint bytes and scoring were not independently replayed.',
                     'Pareto labels are descriptive, based on means; not a formal uncertainty-aware inference.',
                     'Equal optimizer updates or sample counts do not imply equal training FLOPs.'],
            'arms':reports}


def main(argv: list[str] | None=None)->int:
    p=argparse.ArgumentParser(description='Descriptive quality/cost frontier; never grants scientific qualification')
    p.add_argument('manifest',type=Path)
    p.add_argument('--study',required=True)
    p.add_argument('--metric',default='nll')
    p.add_argument('--split',default='test')
    p.add_argument('--mode',default='reset_windows')
    p.add_argument('--cost',default='training_wall_seconds',choices=sorted(COSTS))
    a=p.parse_args(argv)
    try:
        raw=json.loads(a.manifest.read_text(encoding='utf-8'))
        out=frontier(raw,study=a.study,metric=a.metric,split=a.split,mode=a.mode,cost=a.cost)
        print(json.dumps(out,indent=2,sort_keys=True,allow_nan=False));return 0
    except (ContractError,ValueError,OSError,KeyError,TypeError) as exc:
        print(json.dumps({'status':'INVALID','error':str(exc)}));return 2


if __name__=='__main__':
    raise SystemExit(main())
