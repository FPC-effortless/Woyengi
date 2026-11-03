"""Conservative read-only Transformer107 source-results adapter.

This imports the three original published final checkpoint IDs, twelve
per-seed metric pairs and the audit's reported artifact checks. It DOES NOT
validate the original model bytes or infer missing individual-run receipts.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
from wil_rbs import ContractError, require, validate

BRANCH = "research/langbase107-transformer-control-2026-10-31"
ROOT = "https://github.com/FPC-effortless/TAC-OSM/blob/" + BRANCH + "/research/langbase107_results/"
RESULT_URL = ROOT + "RESULT.json"
AUDIT_URL = ROOT + "AUDIT.json"
SOURCE_DATA_SHA = "86c4e6aa9db7c042ec79f339dcb96d42b0075e16b8fc2e86bf0ca57e2dc565ed"
SEEDS = (10601, 10602, 10603)
# Captured from original GitHub artifact ZIP bytes after matching independent
# original artifact hashes in AUDIT.json. The CI fixture must match these
# exact FIT_RECEIPT.json bytes; simply relabeling a wall-time is rejected.
RAW_RECEIPT_SHA256 = {
    10601:'2cc8eb28bc091097d99fe3d76dcf8b1f35d0c21f134dc2dfaffdf919712bb8da',
    10602:'2ae6d7aa5466329e9235ee0a9b6d1c6ff8ecc888e7f40781147485a5ff9bc862',
    10603:'766288fe983e9fdb376ac88c44a70d6d2298b95946628e7c9737ba2603fbf5fc',
}
STEPS = 4096
EXPOSURES = 4194304
TARGETS = 55769


def reported_evidence() -> dict:
    return {"level": "reported", "refs": [RESULT_URL, AUDIT_URL],
            "source_note": "Published three-seed report and audit, not independently re-run or downloaded checkpoint bytes"}


def _bundle_receipts(bundle: dict | None, audit: dict, results: dict) -> dict[int,dict]:
    if bundle is None:
        return {}
    require(bundle.get('schema') == 'wil-rbs.transformer107-extracted-receipts.v1',
            'unexpected extracted-receipt bundle schema')
    cohort = bundle.get('cohort')
    require(isinstance(cohort,list) and len(cohort)==3, 'complete three-seed receipt cohort required')
    originals={x['name']:x for x in audit['original_artifacts']}
    found={}
    for entry in cohort:
        r=entry['fit_receipt'];seed=r['seed']
        require(seed in SEEDS and seed not in found,'duplicate or unknown fit seed')
        raw=base64.b64decode(entry['raw_fit_receipt_b64'],validate=True)
        require(hashlib.sha256(raw).hexdigest()==entry['fit_receipt_sha256']==RAW_RECEIPT_SHA256[seed],
                'original FIT_RECEIPT.json byte digest mismatch')
        require(json.loads(raw)==r, 'stored parsed receipt differs from original raw FIT_RECEIPT.json bytes')
        artifact=originals[f'LANGBASE107-fit-{seed}-attempt-1']
        require(entry['artifact_id']==artifact['id'] and entry['artifact_name']==artifact['name'] and
                entry['artifact_zip_sha256']==artifact['zip_sha256'],
                'source archive hash or identity differs from published independent audit')
        require(r['schema']=='langbase107.owner-fit-receipt.v1' and r['status']=='FIT_COMPLETED_EXPLORATORY',
                'unexpected fit receipt schema/status')
        require(r['arm']=='causal_transformer' and r['parameter_count']==998816,'fit architecture differs')
        require(r['actual_steps']==r['expected_steps']==STEPS and
                r['training_byte_presentations']==EXPOSURES,
                'fit budget/exposure differs')
        require(r['source_sha256']==SOURCE_DATA_SHA and
                r['train_sha256']=='a9e24e23a1ec77744dad26844bfd5a09b6e041954e1eef0000e7f24cba6db735',
                'original data-source/train split differs')
        require(r['protocol_sha256']==results['protocol_sha256'], 'fit protocol differs')
        require(r['checkpoint_sha256']==audit['checkpoint_sha256'][str(seed)], 'final fit checkpoint differs')
        require(r['independently_qualified'] is False and r['architecture_superiority'] is False and
                r['test_accessed'] is False and r['dev_scored'] is False,
                'unexpected source scientific evaluation status')
        require(r['full_training_flops']=='NOT_CERTIFIED',
                'actual total FLOP certification changed; inspect original receipt')
        checks=entry['checkpoint_bytes_verified']
        expected=[0,256,1024,2048,4096]
        require([x['step'] for x in checks]==expected and
                checks==[{'step':x['step'],'file':x['file'],'sha256':x['sha256']} for x in r['checkpoints']],
                'checkpoint manifest differs from captured archive byte checks')
        require(r['checkpoints'][-1]['sha256']==r['checkpoint_sha256'],
                'final checkpoint hash differs from fit history')
        require(type(r['wall_seconds']) in (int,float) and r['wall_seconds']>0,
                'missing fit wall time')
        found[seed]=entry
    require(set(found)==set(SEEDS),'missing original seed receipt')
    return found


def import_langbase107(results: dict, audit: dict, *, fit_receipts: dict | None = None,
                       results_bytes: bytes | None = None, audit_bytes: bytes | None = None) -> dict:
    require(results.get("schema") == "langbase107.owner-final-evaluation.v1", "unexpected Transformer107 source schema")
    require(results.get("status") == "THREE_TRANSFORMER_FITS_POSTHOC_EVALUATED_EXPLORATORY", "unexpected source status")
    require(results.get("independently_qualified") is False and results.get("architecture_superiority_eligible") is False,
            "unexpected source scientific-qualification status")
    require(audit.get("schema") == "langbase107.independent-result-audit.v1", "unexpected audit schema")
    require(audit.get("checks_passed") == 35, "unexpected audit coverage")
    require(audit.get("qualification") == "independent arithmetic and artifact-integrity audit; no independent scientific attestation or complete FLOP certification",
            "unexpected scientific qualification change: review the adapter")
    require(results.get("source_sha256") == SOURCE_DATA_SHA, "original data-source digest changed")
    require(results.get("transformer", {}).get("parameters") == 998816, "model parameter count changed")
    runs = results.get("runs")
    require(isinstance(runs, list) and len(runs) == 3, "expected 3 original Transformer107 seeds")
    checks = audit.get("checkpoint_sha256")
    require(isinstance(checks, dict) and set(checks) == {str(s) for s in SEEDS}, "audit checkpoint set differs")
    require({r.get("seed") for r in runs} == set(SEEDS), "missing or duplicated source seeds")
    require(isinstance(audit.get("original_artifacts"), list) and len(audit["original_artifacts"]) == 4,
            "expected three fit artifacts and final evaluation")
    verified_receipts=_bundle_receipts(fit_receipts,audit,results)
    records=[]
    for row in sorted(runs, key=lambda r:r["seed"]):
        seed=row["seed"]
        ck=row["checkpoint_sha256"]
        require(ck == checks[str(seed)] and len(ck) == 64, "reported checkpoint does not match original audit")
        require(row["resources"]["carried_tensor_bytes"] == results["transformer"]["carried_tensor_bytes"],
                "carried-state size inconsistent with original summary")
        name=f"langbase107-transformer-seed{seed}"
        entry=verified_receipts.get(seed)
        receipt=entry['fit_receipt'] if entry else None
        records.append({
            "kind":"run", "id":name,"project_id":"TAC-OSM","study_id":"LANGBASE107",
            "arm_id":"transformer107-four","seed":seed,
            "source_commit":audit["source_head_sha"], "checkpoint_sha256":ck,
            "model":{"family":"Transformer107 4-layer", "trainable_parameters":998816,
                     "deployed_parameters":998816,"config_sha256":None},
            "data":{"dataset_id":"TinyShakespeare", "dataset_sha256":SOURCE_DATA_SHA,
                    "train_split_sha256":receipt['train_sha256'] if receipt else None,
                    "sample_order_sha256":receipt['sample_offset_sha256'] if receipt else None,
                    "target_contract_sha256":None,"tokenizer_sha256":None,"preprocessing_sha256":None,
                    "target_unit":"byte", "train_exposure_units":EXPOSURES,"context_length":128},
            "training":{"optimizer":"AdamW","updates":STEPS,"optimizer_contract_sha256":None,
                        "tuning_policy_sha256":None,"selection_policy_sha256":None},
            "resources":{"wall_seconds":receipt['wall_seconds'] if receipt else None,"flop_budget":None,
                         "training_flops":{"value":None,"method":"unavailable"},
                         "persistent_state_bytes":row["resources"]["carried_tensor_bytes"],
                         "decode_bytes_per_second_reported":row["resources"]["decode_bytes_per_second_median"]},
            "source_receipt":{"audit_checks_passed":audit["checks_passed"],
                              "extracted_fit_receipt_sha256":entry['fit_receipt_sha256'] if entry else None,
                              "source_artifact_zip_sha256":entry['artifact_zip_sha256'] if entry else None,
                              "process_cpu_seconds":receipt['process_cpu_seconds'] if receipt else None,
                              "peak_rss_bytes":receipt['peak_rss_bytes'] if receipt else None,
                              "reported_first_fit_loss":receipt['first_fit_loss'] if receipt else None,
                              "reported_last_fit_loss":receipt['last_fit_loss'] if receipt else None,
                              "workflow_run_id":audit["workflow_run_id"],
                              "original_fit_zip_sha256":next(x["zip_sha256"] for x in audit["original_artifacts"] if x["name"] == f"LANGBASE107-fit-{seed}-attempt-1"),
                              "missing_per_seed_fit_time":entry is None,
                              "original_aggregate_not_independent_attestation":True},
            "evidence":reported_evidence()})
        source_cps=receipt['checkpoints'] if receipt else [{'step':STEPS,'sha256':ck,'file':'checkpoint-4096.pt'}]
        for cp in source_cps:
            records.append({"kind":"checkpoint", "id":name+f"-step{cp['step']}", "run_id":name,
                            "step":cp['step'],"checkpoint_sha256":cp['sha256'],
                            "project_id":"TAC-OSM","study_id":"LANGBASE107",
                            "artifact_name":cp['file'], "evidence":reported_evidence()})
        for prefix, split, mode in (("dev_reset","dev","reset_windows"),
                                    ("dev_carry","dev","continuous_carry"),
                                    ("test_reset","test","reset_windows"),
                                    ("test_carry","test","continuous_carry")):
            metrics=row[prefix]
            require(metrics["targets"] == TARGETS, f"seed {seed}: inconsistent {prefix} target count")
            for metric_name, key, unit, direction in (("nll","nll_nats","nat/byte","min"),
                                                      ("next_byte_accuracy","accuracy","ratio","max")):
                records.append({"kind":"evaluation", "id":f"{name}-{split}-{mode}-{metric_name}",
                                "project_id":"TAC-OSM","study_id":"LANGBASE107",
                                "run_id":name,"checkpoint_id":name+"-step4096",
                                "checkpoint_sha256":ck,
                                "metric":{"name":metric_name,"unit":unit,"direction":direction,
                                          "split":split,"protocol_mode":mode,
                                          "value":metrics[key],"target_count":TARGETS,
                                          "target_sha256":None,"evaluator_sha256":None},
                                "evidence":reported_evidence()})
    expected=results["transformer"]["mean_test_reset_nll_nats"]
    mean=sum(r["test_reset"]["nll_nats"] for r in runs)/3
    require(abs(mean-expected)<1e-10,"published Transformer107 aggregate NLL disagrees with seed scores")
    output={"schema":"wil-rbs.v1","records":records,
            "import_metadata":{"status":"ORIGINAL_ARCHIVE_DIGESTS_CAPTURED_FIT_RECEIPTS" if verified_receipts else "REPORTED_UPSTREAM_ARTIFACTS_NOT_REVERIFIED",
                               "fit_archives_sha256_checked_at_capture":bool(verified_receipts),
                               "source_code_did_not_retrain_or_rescore":True,
                               "result_bytes_sha256":hashlib.sha256(results_bytes).hexdigest() if results_bytes else None,
                               "audit_bytes_sha256":hashlib.sha256(audit_bytes).hexdigest() if audit_bytes else None,
                               "audit_status":"reported source audit, not independently authenticated by WIL-RBS"}}
    validate(output)
    return output


def main(argv: list[str] | None = None) -> int:
    parser=argparse.ArgumentParser(description="Import source-published Transformer107 seed metrics without fabricating run receipts")
    parser.add_argument("result",type=Path)
    parser.add_argument("audit",type=Path)
    parser.add_argument("--output",required=True,type=Path)
    parser.add_argument("--receipts",type=Path,help="optional extracted/verified original fit-receipt bundle")
    args=parser.parse_args(argv)
    try:
        rb=args.result.read_bytes();ab=args.audit.read_bytes()
        bundle=json.loads(args.receipts.read_bytes()) if args.receipts else None
        result=import_langbase107(json.loads(rb),json.loads(ab),fit_receipts=bundle,results_bytes=rb,audit_bytes=ab)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(result,indent=2,sort_keys=True,allow_nan=False)+"\n",encoding="utf-8")
        print(json.dumps({"status":"IMPORTED","runs":3,"checkpoints":15 if bundle else 3,"evaluations":24,
                          "training_flops":"UNKNOWN","per_seed_training_time":"SOURCE_RECEIPT" if bundle else "UNKNOWN",
                          "output":str(args.output)}))
        return 0
    except (OSError,ContractError,ValueError,KeyError,TypeError,StopIteration,base64.binascii.Error) as exc:
        print(json.dumps({"status":"INVALID","error":str(exc)}))
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
