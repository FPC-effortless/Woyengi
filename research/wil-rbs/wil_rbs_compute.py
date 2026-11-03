"""Explicitly partial FLOP/MAC receipts; never a certified training FLOP metric.

PyTorch profiler with_flops and forward hooks cover only particular kernels;
without a complete operator inventory, backward/optimizer/communication and
independent execution audit, total-training FLOPs remain UNKNOWN.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from wil_rbs import ContractError, require

VERSION="wil-rbs.partial-compute.v1"
METHODS={'source_operator_hooks','torch_profiler_partial','static_operator_estimate'}


def audit_partial(receipt:dict)->dict:
    require(isinstance(receipt,dict) and receipt.get('schema')==VERSION,'unsupported partial-compute format')
    require(receipt.get('method') in METHODS,'unknown compute counting method')
    require(receipt.get('scope')=='partial_projection_only','unsupported scope: cannot infer end-to-end training FLOPs')
    require(isinstance(receipt.get('run_id'),str) and receipt['run_id'].strip(),'run_id required')
    source_ref=receipt.get('source_ref')
    if source_ref is None:
        require(isinstance(receipt.get('source_note'),str) and len(receipt['source_note'].strip())>=12,
                'source without public URL requires a substantive source note')
    else:
        require(isinstance(source_ref,str) and source_ref.startswith('https://'),
                'source_ref must be HTTPS if present')
    units=receipt.get('projection_macs_per_input_unit')
    require(type(units) in (int,float) and math.isfinite(units) and units>0,'positive projection MAC count required')
    require(receipt.get('input_unit') in {'byte','character','token'},'input unit must be explicit')
    require(receipt.get('forward_only') is True,'forward projection count must be marked forward-only')
    missing=receipt.get('unaccounted_categories')
    require(isinstance(missing,list) and len(missing)>0 and all(isinstance(x,str) and x.strip() for x in missing),
            'incomplete operator coverage must be disclosed')
    require('backward' in missing and 'optimizer' in missing,
            'missing backward/optimizer arithmetic must be explicit')
    return {'status':'PARTIAL_DIAGNOSTIC_ONLY','run_id':receipt['run_id'],
            'scope':'partial_projection_only','method':receipt['method'],
            'input_unit':receipt['input_unit'],
            'forward_projection_macs_per_input_unit':units,
            'forward_projection_flops_per_input_unit':2*units,
            'training_flops':None,'end_to_end_training_flops_eligible':False,
            'unaccounted_categories':missing,'source_ref':source_ref,
            'source_note':receipt.get('source_note'),
            'scientific_superiority_authorized':False}


def main(argv:list[str]|None=None)->int:
    p=argparse.ArgumentParser(description='Audit scope of a partial projection-MAC census')
    p.add_argument('receipt',type=Path);a=p.parse_args(argv)
    try:
        r=audit_partial(json.loads(a.receipt.read_text()))
        print(json.dumps(r,indent=2,sort_keys=True,allow_nan=False));return 0
    except (OSError,ValueError,TypeError,KeyError,ContractError) as exc:
        print(json.dumps({'status':'INVALID','error':str(exc)}));return 2

if __name__=='__main__':raise SystemExit(main())
