"""WIL-RBS v1 experimental append-only research record log (POSIX filesystem).

Tamper-evident hash chain, not a trusted/signature-backed ledger. Anchor the
returned head digest externally (e.g., a reviewed Git commit) to detect a
whole-file replacement. Readers/writers cooperate through POSIX flock.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
from wil_rbs import ContractError, require, validate

VERSION="wil-rbs-ledger.v1"
GENESIS="0"*64


def canonical(value: object)->bytes:
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode('utf-8')


def digest(value: object)->str:
    return hashlib.sha256(canonical(value)).hexdigest()


def _json(value: bytes)->dict:
    return json.loads(value,parse_constant=lambda x: (_ for _ in ()).throw(ContractError(f'non-finite JSON: {x}')))


def _events(raw: bytes)->list[dict]:
    if not raw:return []
    require(raw.endswith(b'\n'),'partial/torn trailing ledger write')
    records=[]; events=[]; previous=GENESIS
    for line in raw.splitlines():
        require(bool(line),'empty event line is invalid')
        row=_json(line)
        require(isinstance(row,dict) and set(row)=={'schema','index','previous_sha256','record_sha256','record','event_sha256'},'unrecognized ledger event structure')
        require(row['schema']==VERSION and type(row['index']) is int and row['index']==len(events)+1,'event index gap or wrong version')
        require(row['previous_sha256']==previous,'ledger chain gap')
        require(row['record_sha256']==digest(row['record']),'ledger record hash mismatch')
        require(row['event_sha256']==digest({k:v for k,v in row.items() if k!='event_sha256'}),'ledger event hash mismatch')
        previous=row['event_sha256']
        events.append(row);records.append(row['record'])
    validate({'schema':'wil-rbs.v1','records':records})
    return events


def _locked_fd(path:Path,exclusive:bool):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(path,os.O_RDWR|os.O_CREAT,0o600)
    fcntl.flock(fd,fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
    return fd


def load(path:Path)->tuple[list[dict],str]:
    if not path.exists():return [],GENESIS
    fd=_locked_fd(path,False)
    try:
        os.lseek(fd,0,os.SEEK_SET)
        with os.fdopen(os.dup(fd),'rb') as f: raw=f.read()
        events=_events(raw)
        return [r['record'] for r in events],events[-1]['event_sha256'] if events else GENESIS
    finally:
        fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)


def append_manifest(path:Path,manifest:dict,*,idempotent:bool=False)->dict:
    validate(manifest)
    incoming=manifest['records']
    fd=_locked_fd(path,True)
    try:
        os.lseek(fd,0,os.SEEK_SET)
        with os.fdopen(os.dup(fd),'rb') as f: old=_events(f.read())
        existing={e['record']['id']:e['record'] for e in old}
        additional=[];duplicates=0
        for record in incoming:
            rid=record['id']
            if rid in existing:
                require(idempotent and canonical(existing[rid])==canonical(record),f'duplicate or conflicting ID: {rid}')
                duplicates+=1
            else:
                additional.append(record)
        if additional:
            validate({'schema':'wil-rbs.v1','records':[e['record'] for e in old]+additional})
        prior=old[-1]['event_sha256'] if old else GENESIS
        entries=[]
        for record in additional:
            event={'schema':VERSION,'index':len(old)+len(entries)+1,'previous_sha256':prior,
                   'record_sha256':digest(record),'record':record}
            event['event_sha256']=digest(event)
            prior=event['event_sha256']
            entries.append(event)
        if entries:
            payload=b''.join(canonical(e)+b'\n' for e in entries)
            os.lseek(fd,0,os.SEEK_END)
            while payload:
                sent=os.write(fd,payload)
                require(sent>0,'write did not make progress')
                payload=payload[sent:]
            os.fsync(fd)
        return {'status':'APPENDED','added':len(entries),'existing_identical':duplicates,
                'event_count':len(old)+len(entries),'head_sha256':prior,
                'external_anchor_required':True,'scientific_qualification':'NOT_ASSESSED'}
    finally:
        fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)


def main(argv:list[str]|None=None)->int:
    p=argparse.ArgumentParser(description='Append-only experimental research records; source hashes do not verify scientific claims')
    sub=p.add_subparsers(dest='action',required=True)
    add=sub.add_parser('append');add.add_argument('ledger',type=Path);add.add_argument('manifest',type=Path)
    add.add_argument('--idempotent',action='store_true')
    verify=sub.add_parser('verify');verify.add_argument('ledger',type=Path)
    export=sub.add_parser('export');export.add_argument('ledger',type=Path);export.add_argument('--output',type=Path,required=True)
    a=p.parse_args(argv)
    try:
        if a.action=='append':
            obj=_json(a.manifest.read_bytes());output=append_manifest(a.ledger,obj,idempotent=a.idempotent)
        else:
            rows,head=load(a.ledger)
            require(bool(rows),'empty ledger: nothing to verify or export')
            output={'status':'VALID','records':len(rows),'head_sha256':head,
                    'external_anchor_required':True,'scientific_qualification':'NOT_ASSESSED'}
            if a.action=='export':
                a.output.write_bytes(json.dumps({'schema':'wil-rbs.v1','records':rows},indent=2,sort_keys=True,allow_nan=False).encode()+b'\n')
                output['export']=str(a.output)
        print(json.dumps(output,sort_keys=True,allow_nan=False));return 0
    except (OSError,ValueError,TypeError,ContractError,KeyError) as exc:
        print(json.dumps({'status':'INVALID','error':str(exc)}));return 2

if __name__=='__main__':raise SystemExit(main())
