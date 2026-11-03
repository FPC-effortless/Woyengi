"""WIL-RBS v1: conservative, dependency-free research record validator.

This library records *comparability*, not scientific qualification. It never
reads model weights, checks original experiments, or certifies FLOPs itself.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

SCHEMA = "wil-rbs.v1"
LEVELS = {"reported", "source_reproduced", "independently_verified"}
FLOP_METHODS = {"unavailable", "analytical_estimate", "operator_census", "measured_profiler"}
DIGEST = re.compile(r"^[0-9a-f]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")

class ContractError(ValueError):
    pass


def require(value: bool, message: str) -> None:
    if not value:
        raise ContractError(message)


def obj(value: Any, path: str) -> dict:
    require(isinstance(value, dict), f"{path} must be an object")
    return value


def nonempty(value: Any, path: str) -> str:
    require(isinstance(value, str) and bool(value.strip()), f"{path} must be a nonempty string")
    return value


def number(value: Any, path: str, *, integer: bool = False, positive: bool = False) -> None:
    require(not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value), f"{path} must be finite numeric")
    if integer:
        require(isinstance(value, int), f"{path} must be an integer")
    require(value > 0 if positive else value >= 0, f"{path} must be {'positive' if positive else 'nonnegative'}")


def sha(value: Any, path: str, *, required: bool = False, commit: bool = False) -> None:
    if value is None and not required:
        return
    require(isinstance(value, str) and bool((COMMIT if commit else DIGEST).fullmatch(value)), f"{path} must be a lowercase {40 if commit else 64}-hex digest")


def evidence(value: Any, path: str, *, aggregate: bool = False) -> str:
    x = obj(value, path)
    level = x.get("level")
    require(level in LEVELS, f"{path}.level invalid")
    if aggregate:
        require(level != "independently_verified", "aggregate historical summaries cannot claim independently verified raw-run evidence")
    urls = x.get("refs")
    require(isinstance(urls, list) and all(isinstance(u, str) and u.startswith("https://") for u in urls), f"{path}.refs must be HTTPS source links")
    if not urls:
        require(level == "reported", f"{path}: verified evidence requires source links")
        nonempty(x.get("source_note"), f"{path}.source_note")
    return level


def model(value: Any, path: str) -> None:
    x = obj(value, path)
    nonempty(x.get("family"), f"{path}.family")
    number(x.get("trainable_parameters"), f"{path}.trainable_parameters", integer=True, positive=True)
    number(x.get("deployed_parameters"), f"{path}.deployed_parameters", integer=True, positive=True)
    require(x["deployed_parameters"] >= x["trainable_parameters"], f"{path}: deployed parameters below trainable")
    sha(x.get("config_sha256"), f"{path}.config_sha256")


def metric(value: Any, path: str, *, historical: bool = False) -> None:
    x = obj(value, path)
    nonempty(x.get("name"), f"{path}.name")
    nonempty(x.get("unit"), f"{path}.unit")
    nonempty(x.get("split"), f"{path}.split")
    require(x.get("direction") in {"min", "max"}, f"{path}.direction invalid")
    value = x.get("value")
    require(not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value), f"{path}.value must be finite numeric")
    if x.get("target_count") is not None or not historical:
        number(x.get("target_count"), f"{path}.target_count", integer=True, positive=True)
    sha(x.get("target_sha256"), f"{path}.target_sha256")
    sha(x.get("evaluator_sha256"), f"{path}.evaluator_sha256")


def resources(value: Any, path: str) -> None:
    x = obj(value, path)
    if x.get("wall_seconds") is not None:
        number(x["wall_seconds"], f"{path}.wall_seconds")
    flops = obj(x.get("training_flops"), f"{path}.training_flops")
    require(flops.get("method") in FLOP_METHODS, f"{path}.training_flops.method invalid")
    v = flops.get("value")
    if v is None:
        require(flops["method"] == "unavailable", f"{path}: FLOP method without FLOP receipt")
    else:
        number(v, f"{path}.training_flops.value", positive=True)
        require(flops["method"] != "unavailable", f"{path}: FLOPs need method")
        require(flops.get("scope") == "end_to_end_training", f"{path}: partial FLOP census cannot masquerade as end-to-end")
        if flops["method"] in {"operator_census", "measured_profiler"}:
            nonempty(flops.get("receipt_ref"), f"{path}.training_flops.receipt_ref")
    if x.get("flop_budget") is not None:
        number(x["flop_budget"], f"{path}.flop_budget", positive=True)


def validate(data: Any) -> dict:
    root = obj(data, "manifest")
    require(root.get("schema") == SCHEMA, "unsupported schema")
    records = root.get("records")
    require(isinstance(records, list) and bool(records), "records must be a nonempty list")
    seen: set[str] = set()
    runs: dict[str, dict] = {}
    counts = {"run": 0, "evaluation": 0, "historical_aggregate": 0}
    for i, raw in enumerate(records):
        p = f"records[{i}]"
        r = obj(raw, p)
        kind = r.get("kind")
        require(kind in counts, f"{p}.kind unsupported")
        rid = nonempty(r.get("id"), f"{p}.id")
        require(rid not in seen, f"duplicate record ID {rid}")
        seen.add(rid)
        nonempty(r.get("project_id"), f"{p}.project_id")
        nonempty(r.get("study_id"), f"{p}.study_id")
        evidence(r.get("evidence"), f"{p}.evidence", aggregate=kind == "historical_aggregate")
        counts[kind] += 1
        if kind in {"run", "historical_aggregate"}:
            model(r.get("model"), f"{p}.model")
            d = obj(r.get("data"), f"{p}.data")
            nonempty(d.get("dataset_id"), f"{p}.data.dataset_id")
            nonempty(d.get("target_unit"), f"{p}.data.target_unit")
            for k in ("dataset_sha256", "train_split_sha256", "sample_order_sha256", "target_contract_sha256", "tokenizer_sha256", "preprocessing_sha256"):
                sha(d.get(k), f"{p}.data.{k}")
            number(d.get("train_exposure_units"), f"{p}.data.train_exposure_units", integer=True, positive=True)
            number(d.get("context_length"), f"{p}.data.context_length", integer=True, positive=True)
            t = obj(r.get("training"), f"{p}.training")
            nonempty(t.get("optimizer"), f"{p}.training.optimizer")
            number(t.get("updates"), f"{p}.training.updates", integer=True, positive=True)
            for k in ("optimizer_contract_sha256", "tuning_policy_sha256", "selection_policy_sha256"):
                sha(t.get(k), f"{p}.training.{k}")
            resources(r.get("resources"), f"{p}.resources")
            if kind == "run":
                nonempty(r.get("arm_id"), f"{p}.arm_id")
                number(r.get("seed"), f"{p}.seed", integer=True)
                sha(r.get("source_commit"), f"{p}.source_commit", commit=True)
                sha(r.get("checkpoint_sha256"), f"{p}.checkpoint_sha256")
                if r["evidence"]["level"] == "independently_verified":
                    for k in ("dataset_sha256", "train_split_sha256", "sample_order_sha256", "target_contract_sha256", "tokenizer_sha256", "preprocessing_sha256"):
                        sha(d.get(k), f"{p}.data.{k}", required=True)
                    sha(r.get("source_commit"), f"{p}.source_commit", required=True, commit=True)
                    sha(r.get("checkpoint_sha256"), f"{p}.checkpoint_sha256", required=True)
                runs[rid] = r
            else:
                number(r.get("seed_count"), f"{p}.seed_count", integer=True, positive=True)
                metric(r.get("metric"), f"{p}.metric", historical=True)
        else:
            nonempty(r.get("run_id"), f"{p}.run_id")
            metric(r.get("metric"), f"{p}.metric")
            sha(r.get("checkpoint_sha256"), f"{p}.checkpoint_sha256")
            if r["evidence"]["level"] == "independently_verified":
                sha(r.get("checkpoint_sha256"), f"{p}.checkpoint_sha256", required=True)
                sha(r["metric"].get("target_sha256"), f"{p}.metric.target_sha256", required=True)
                sha(r["metric"].get("evaluator_sha256"), f"{p}.metric.evaluator_sha256", required=True)
    for r in records:
        if r["kind"] == "evaluation":
            require(r["run_id"] in runs, f"evaluation {r['id']}: orphan run_id")
            parent = runs[r["run_id"]]
            require(r["study_id"] == parent["study_id"] and r["project_id"] == parent["project_id"], f"evaluation {r['id']}: parent identity mismatch")
            if r.get("checkpoint_sha256") and parent.get("checkpoint_sha256"):
                require(r["checkpoint_sha256"] == parent["checkpoint_sha256"], f"evaluation {r['id']}: checkpoint differs from run")
            if r["evidence"]["level"] == "independently_verified":
                require(parent["evidence"]["level"] == "independently_verified", f"evaluation {r['id']}: parent run lacks independent verification")
    return {"status": "VALID", "schema": SCHEMA, "counts": counts, "records": len(records),
            "scientific_qualification": "NOT_ASSESSED"}


def _record_parts(record: dict, lookup: dict[str, dict]) -> tuple[dict, dict]:
    if record["kind"] == "historical_aggregate":
        return record, record["metric"]
    require(record["kind"] == "evaluation", "comparisons require evaluation or historical_aggregate record IDs")
    return lookup[record["run_id"]], record["metric"]


def _all_present_equal(left: dict, right: dict, keys: tuple[str, ...]) -> bool:
    return all(left.get(k) is not None and left.get(k) == right.get(k) for k in keys)


def _within(a: float, b: float, tolerance: float = 0.01) -> bool:
    return abs(a - b) / max(a, b) <= tolerance


def compare(data: dict, a_id: str, b_id: str) -> dict:
    validate(data)
    lookup = {r["id"]: r for r in data["records"]}
    require(a_id != b_id and a_id in lookup and b_id in lookup, "comparison needs two different existing IDs")
    a, ma = _record_parts(lookup[a_id], lookup)
    b, mb = _record_parts(lookup[b_id], lookup)
    param = _within(a["model"]["trainable_parameters"], b["model"]["trainable_parameters"]) and _within(a["model"]["deployed_parameters"], b["model"]["deployed_parameters"])
    targets = _all_present_equal(ma, mb, ("name", "unit", "split", "target_count", "target_sha256", "evaluator_sha256")) and ma["direction"] == mb["direction"]
    data_keys = ("dataset_sha256", "train_split_sha256", "sample_order_sha256", "target_contract_sha256", "tokenizer_sha256", "preprocessing_sha256", "train_exposure_units", "context_length", "target_unit")
    data_equal = _all_present_equal(a["data"], b["data"], data_keys)
    af, bf = a["resources"]["training_flops"], b["resources"]["training_flops"]
    full_flops = (af.get("value") is not None and bf.get("value") is not None and
                  af["method"] == bf["method"] and af["method"] in {"operator_census", "measured_profiler"} and
                  af.get("scope") == bf.get("scope") == "end_to_end_training" and
                  _within(af["value"], bf["value"]) and
                  a["resources"].get("flop_budget") is not None and b["resources"].get("flop_budget") is not None and
                  _within(a["resources"]["flop_budget"], b["resources"]["flop_budget"]))
    ta,tb=a["training"],b["training"]
    selection = _all_present_equal(ta,tb,("optimizer_contract_sha256","tuning_policy_sha256","selection_policy_sha256"))
    independently_declared = (all(rec["evidence"]["level"] == "independently_verified" for rec in (a,b,lookup[a_id],lookup[b_id])) and
                   lookup[a_id]["kind"] == lookup[b_id]["kind"] == "evaluation")
    full = param and data_equal and full_flops and targets and selection and independently_declared and a["study_id"] == b["study_id"]
    return {
        "left": a_id, "right": b_id,
        "parameter_matched_1pct": param,
        "data_exposure_matched": data_equal,
        "end_to_end_compute_matched_1pct": bool(full_flops),
        "evaluation_targets_identical": targets,
        "selection_policy_matched": selection,
        "independent_evidence_declared": independently_declared,
        "fully_controlled_candidate": full,
        "scientific_superiority_authorized": False,
        "quality_ranking": ("left" if ma["value"] < mb["value"] else "right" if ma["value"] > mb["value"] else "tie") if targets and ma["direction"] == "min" else ("left" if ma["value"] > mb["value"] else "right" if ma["value"] < mb["value"] else "tie") if targets else "NOT_COMPARABLE",
        "warnings": ["This checks declared receipts and identity fields; it does not independently measure FLOPs, inspect model outputs or grant research promotion."]
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="WIL-RBS v1 research benchmark contract")
    sub = p.add_subparsers(dest="command", required=True)
    v = sub.add_parser("validate")
    v.add_argument("manifest", type=Path)
    c = sub.add_parser("compare")
    c.add_argument("manifest", type=Path)
    c.add_argument("left")
    c.add_argument("right")
    args = p.parse_args(argv)
    try:
        data = json.loads(args.manifest.read_text(encoding="utf-8"), parse_constant=lambda s: (_ for _ in ()).throw(ContractError(f"non-finite JSON constant {s}")))
        out = validate(data) if args.command == "validate" else compare(data, args.left, args.right)
        print(json.dumps(out, sort_keys=True, indent=2, allow_nan=False))
        return 0
    except (ContractError, ValueError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "INVALID", "error": str(exc)}))
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
