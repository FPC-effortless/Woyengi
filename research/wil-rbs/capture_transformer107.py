"""Extract exact original Transformer107 FIT_RECEIPT data from GitHub artifact ZIPs.

Requires separately obtained original ZIPs and the publisher's AUDIT.json.
Checks whole ZIP and every checkpoint member SHA-256 before producing a small
receipt bundle. No model fitting, loading, or prediction occurs.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import zipfile
from pathlib import Path
from wil_rbs import ContractError, require


def file_sha(path:Path)->str:
    with path.open('rb') as fd:return hashlib.file_digest(fd,'sha256').hexdigest()


def capture(audit:dict, paths:list[Path])->dict:
    expected={a['id']:a for a in audit['original_artifacts'] if a['name'].startswith('LANGBASE107-fit-')}
    require(len(paths)==len(expected)==3, 'expected three original ZIP files')
    output=[];seen=set()
    for p in paths:
        actual=file_sha(p)
        matching=[a for a in expected.values() if a['zip_sha256']==actual]
        require(len(matching)==1, f'archive SHA mismatch or unknown artifact: {p.name}')
        meta=matching[0]
        with zipfile.ZipFile(p) as z:
            names=z.namelist()
            require('FIT_RECEIPT.json' in names and len(names)==len(set(names)), 'missing or repeated receipt in archive')
            raw=z.read('FIT_RECEIPT.json')
            receipt=json.loads(raw)
            seed=receipt.get('seed')
            require(seed in (10601,10602,10603) and seed not in seen, 'invalid or duplicate fit seed')
            require(meta['name']==f'LANGBASE107-fit-{seed}-attempt-1','wrong fit archive seed')
            require(receipt['checkpoint_sha256']==audit['checkpoint_sha256'][str(seed)], 'final checkpoint differs from audit')
            checks=[]
            for cp in receipt['checkpoints']:
                name=cp['file']
                require(name in names,'checkpoint file missing')
                with z.open(name,'r') as f:
                    sha=hashlib.sha256()
                    while (chunk:=f.read(1024*1024)): sha.update(chunk)
                require(sha.hexdigest()==cp['sha256'], f'checkpoint bytes mismatch: {name}')
                checks.append({'step':cp['step'],'file':name,'sha256':cp['sha256']})
            require(len(checks)==5 and checks[-1]['step']==4096, 'not all five checkpoints are present')
        seen.add(seed)
        output.append({'artifact_id':meta['id'],'artifact_name':meta['name'],
                       'artifact_zip_sha256':actual,'fit_receipt_sha256':hashlib.sha256(raw).hexdigest(),
                       'checkpoint_bytes_verified':checks,'raw_fit_receipt_b64':base64.b64encode(raw).decode('ascii'),
                       'fit_receipt':receipt})
    require(seen=={10601,10602,10603},'not the original three seed cohort')
    return {'schema':'wil-rbs.transformer107-extracted-receipts.v1',
            'provenance':'local whole-ZIP hash and member checks, NOT scientific re-execution or external signature',
            'cohort':sorted(output,key=lambda x:x['fit_receipt']['seed'])}


def main(argv:list[str]|None=None)->int:
    ap=argparse.ArgumentParser(description='Capture original Transformer107 receipts after full ZIP/checkpoint SHA checks')
    ap.add_argument('audit',type=Path);ap.add_argument('archives',type=Path,nargs=3);ap.add_argument('--output',required=True,type=Path)
    a=ap.parse_args(argv)
    try:
        result=capture(json.loads(a.audit.read_text()),a.archives)
        a.output.write_text(json.dumps(result,indent=2,sort_keys=True,allow_nan=False)+'\n')
        print(json.dumps({'status':'CHECKSUMS_VALID','seeds':3,'checkpoint_hashes_verified':15,'output':str(a.output)}))
        return 0
    except (OSError,zipfile.BadZipFile,KeyError,TypeError,ValueError,ContractError) as e:
        print(json.dumps({'status':'INVALID','error':str(e)}));return 2

if __name__=='__main__':raise SystemExit(main())
