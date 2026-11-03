# WIL-RBS v1 — Research Benchmark Standard

**Status:** experimental research-infrastructure reference implementation, not a scientific certification system or production release.

WIL-RBS is a portable, stdlib-only Python contract for storing and comparing model runs without losing the distinction between evidence, experimental fairness, and scientific promotion. It is scoped outside the Woyengi Platform kernel. It does not relax any TAC-OSM research/evaluation authority rules.

## Quick start

Requires Python 3.10+; no third-party dependencies.

```sh
python wil_rbs.py validate examples/historical_aggregates.json
python wil_rbs.py compare examples/historical_aggregates.json tac106-four-summary fusion001-summary
python -m unittest discover -s tests -v
```

The historical comparison returns `parameter_matched_1pct=true`, but `evaluation_targets_identical=false`, `end_to_end_compute_matched_1pct=false`, and `quality_ranking=NOT_COMPARABLE`. This is **correct**: an unequal, unverified historical comparison must not be promoted to a qualified winner.

## Data model

A document has `schema=wil-rbs.v1` and `records[]` with three record types:

- `run`: one concrete implementation, seed, training configuration, dataset contract, resource receipt and checkpoint identity.
- `evaluation`: a frozen scoring result referencing one concrete `run` and checkpoint.
- `historical_aggregate`: a published multi-seed summary when original individual-run evidence has not been imported. This type can never claim independently verified raw-run evidence.

All records carry `project_id`, `study_id`, and an `evidence` block with source references and an explicit evidence level. Raw scores remain attached to metric name, direction, units, split, target count/digest and evaluator digest.

Unlike a typical leaderboard, a missing hash or FLOP measurement is **unknown**, not a zero. An `operator_census` or `measured_profiler` receipt with declared `end_to_end_training` scope is required before a pair can be tagged compute-matched. A real training-rig audit must still verify that the declared receipt matches hardware execution.

## Pairwise comparison

`compare` requires two evaluation or historical-aggregate IDs and reports:

| Field | Meaning |
| --- | --- |
| `parameter_matched_1pct` | Trainable **and** deployed parameter counts within 1% |
| `data_exposure_matched` | Exact cryptographic dataset/split/tokenizer/preprocessing/order/target contracts and exposure/context equality |
| `end_to_end_compute_matched_1pct` | Same measured/census method, full-training scope, actual FLOPs and FLOP budgets within 1% |
| `evaluation_targets_identical` | Same metric, units, split, count, target digest and evaluator digest |
| `selection_policy_matched` | Same non-null optimizer, selection and tuning policy digests |
| `same_hardware_time_budget` | Same hardware/software/precision, identical declared wall-time budget and non-overbudget measured duration |
| `inference_workload_matched` | Same hardware/software, cache-verified mode, fixed workload, batch size and decoding unit |
| `quality_target_matched` | Same target metric, units, validation contract, direction and quality threshold; independent cost-to-target can then be compared |
| `fully_controlled_candidate` | Structural conjunction plus claimed independent evidence; **not** externally verified scientific superiority |
| `quality_ranking` | `left/right/tie` only for identical target/scorer contracts; otherwise `NOT_COMPARABLE` |
| `scientific_superiority_authorized` | Always false: this tool never grants research qualification |

`independent_evidence_declared` verifies the presence of a declaration, **not its authenticity**. A future independent signed-verifier integration must authenticate it. The comparison status is therefore informational until existing scientific gates independently approve it.

## Evidence and metric rules

- `training_flops.value` must be null with method `unavailable`, or a finite positive quantity with method `analytical_estimate`, `operator_census` or `measured_profiler`. Partial MAC-only census **cannot** use `end_to_end_training` scope. The tool enforces field consistency but cannot identify a dishonest measurement without source audit.
- Metric `value` may be negative (e.g. rewards), but never nonfinite or Boolean.
- `nat/byte`, `nat/character`, `nat/token`, `reward/episode` and `ms/byte` are distinct units.
- A historical `target_count` may be null; a new `evaluation` must supply one.
- A `historical_aggregate` may not claim independent raw-run attestation even if its published summary was checked.
- Records are intended for append-only research ledgers. This CLI verifies a snapshot; it does not yet implement storage locking, Merkle commits, signatures, cryptographic verification of profiler receipts, statistical uncertainty or a full dashboard.

## Historical example provenance

TAC106 and Transformer107 values are transcribed from GitHub research PRs #686 and #688. FUSION001 and matched GRU numbers are transcribed from the Woyengi Intelligence Labs research report `FUSION001_Compute_and_Timing_Audit.md` and comparison table from 2026-11-02; exact raw per-run receipts were not brought into this prototype. Historical examples intentionally do not claim verified parity or equal-cost training.

## Scope and next integrations

1. Recover all original individual-run receipts and per-seed scores from TAC-OSM and Fusion rather than reconstructing them from averages.
2. Add streaming JSONL append-only ledger, immutable checkpoint objects, independent signatures and provenance audit.
3. Add full training FLOP instrumentation, time-to-target curves, TTFT and cached decoding by hardware/workload.
4. Add queryable Pareto frontiers and uncertainty-aware reports, with distinct real-world scientific promotion handled by the original domain gates.

Research tracking: https://github.com/FPC-effortless/Woyengi/issues/67

## v1.1: Original per-seed import and quality/cost frontiers

`wil_rbs_ingest.py` imports the original **LANGDEPTH106** `PROTOCOL.json` and `RESULT.json` without fitting, fetching any model weights or asserting independent source/checkpoint verification. The frozen upstream source snapshots live in `examples/upstream/` for deterministic CI, with original research URLs retained in every record.

```sh
python wil_rbs_ingest.py examples/upstream/langdepth106_PROTOCOL.json examples/upstream/langdepth106_RESULT.json --output /tmp/langdepth106_wil_rbs.json
python wil_rbs.py validate /tmp/langdepth106_wil_rbs.json
python wil_rbs_frontier.py /tmp/langdepth106_wil_rbs.json --study LANGDEPTH106 --metric nll --split test --mode reset_windows --cost training_wall_seconds
python wil_rbs_frontier.py /tmp/langdepth106_wil_rbs.json --study LANGDEPTH106 --metric nll --split test --mode reset_windows --cost training_flops
```

The import contains **6 run records, 30 checkpoint records and 48 individual evaluation records** (TEST and DEV; reset and continuous carry; NLL and accuracy). The importer checks source-published step counts, sample-order fingerprints, parameter geometry, per-run checkpoint identity, target counts, and the original paired mean. It deliberately leaves target/evaluator digests and training FLOPs unknown: upstream published receipts say `NOT_MEASURED` for full-training FLOPs. It never fetches/checks the actual `.pt` checkpoint payloads.

`wil_rbs_frontier.py` computes per-arm mean, sample standard deviation, completeness and **descriptive** Pareto membership using observed per-run quality and cost. The output is unconditionally tagged `EXPLORATORY_ONLY` and `scientific_superiority_authorized=false`. Missing cost measurements cause a null frontier, never a zero or invented FLOP rate. It does not construct confidence intervals from reused target bytes or pretend independent qualification from published aggregates.

The historical TAC106 four-layer arm is descriptively better on both mean TEST reset NLL and mean training wall seconds than the eight-layer arm, but this does not establish resource-matched architectural superiority. The same-studier paired-seed analysis and caveats remain governed by the original study.

### Compute instrumentation contract — not yet a measured FLOP result

For actual future training-compute measurement, report **separate** forward, backward, optimizer, attention, normalization, gating, associative-scan, sparse-dispatch and tokenization/representation costs. Define one multiply-accumulate as two floating-point operations. Audit unaccounted/fused kernels explicitly. `torch.profiler(..., with_flops=True)` or linear-only forward hooks are partial counters, not automatically full-training-FLOP receipts. Record actual hardware, precision, threads, batch, sequence length, time basis, warmup, repetitions, synchronization, compiler modes, peak allocated memory, and source-hash identity. Until all required kernel domains have independently checked coverage, mark complete training FLOPs **unavailable** and any counter as `partial` outside the comparability gate.

This workflow is a research-only data-import and benchmarking utility. It does not amend Woyengi's active product PRD, run experiments, open protected test sets, authenticate original checkpoint bytes or change TAC-OSM's external independent-review requirements.

## v1.2: original Transformer107 archive recovery, persistent ledger, and partial compute

The optional `wil_rbs_transformer.py` importer reads source-published
`LANGBASE107` final scoring and the original GitHub artifact-integrity audit.
Unlike the v1.1 TAC importer, the v1.2 Transformer importer can additionally
read a **captured raw FIT receipt bundle** whose three original receipt byte
hashes are pinned in the importer and whose original GitHub ZIP hashes match
the source audit. This bundle was made after downloading all three original
~47 MB fit artifacts, verifying whole-ZIP SHA-256 against `AUDIT.json`, and
verifying all 15 original checkpoint file hashes. The original final-eval
ZIP was also downloaded and matched its audit SHA-256; its `RESULT.json` is
retained unchanged. The 140+ MB original checkpoint archives are deliberately
**not included** in the source repository. Audit inputs and extracted original
receipt bytes are retained in `examples/upstream/`.

Per-seed training wall seconds are therefore **277.1844, 344.6446, 353.2404**,
not imputed from a 325-second aggregate; sample-order digests match TAC106's
corresponding original seeds. The original receipts say `NOT_CERTIFIED` for
full training FLOPs, which this importer preserves as missing. Both result
sets are post-hoc exploratory and none is scientifically qualified.

```sh
# From repository root; requires Python 3.10+
python research/wil-rbs/wil_rbs_transformer.py \
  research/wil-rbs/examples/upstream/langbase107_RESULT.json \
  research/wil-rbs/examples/upstream/langbase107_AUDIT.json \
  --receipts research/wil-rbs/examples/upstream/langbase107_FIT_RECEIPTS.json \
  --output /tmp/wil-rbs-transformer107.json

python research/wil-rbs/wil_rbs_paired.py \
  /tmp/wil-rbs-langdepth106.json /tmp/wil-rbs-transformer107.json

# Append records without changing previously stored records.
python research/wil-rbs/wil_rbs_ledger.py append /tmp/wil-rbs-events.jsonl /tmp/wil-rbs-langdepth106.json
python research/wil-rbs/wil_rbs_ledger.py append /tmp/wil-rbs-events.jsonl /tmp/wil-rbs-transformer107.json
python research/wil-rbs/wil_rbs_ledger.py verify /tmp/wil-rbs-events.jsonl
python research/wil-rbs/wil_rbs_ledger.py export /tmp/wil-rbs-events.jsonl --output /tmp/wil-rbs-all.json

python research/wil-rbs/wil_rbs_compute.py \
  research/wil-rbs/examples/fusion001_projection_mac_report.json
```

To redo source ZIP verification after separately downloading the exact three
original fit archives from [GitHub Actions run 41239984498](https://github.com/FPC-effortless/TAC-OSM/actions/runs/41239984498):

```sh
python research/wil-rbs/capture_transformer107.py \
  research/wil-rbs/examples/upstream/langbase107_AUDIT.json \
  /path/to/LANGBASE107-fit-10601.zip \
  /path/to/LANGBASE107-fit-10602.zip \
  /path/to/LANGBASE107-fit-10603.zip \
  --output /tmp/recovered-receipts.json
```

`wil_rbs_paired.py` refuses unmatched source/fit split hashes, seed offsets,
exposures, context, metric units, and target counts. On original data it
reports a **0.079929 nats/byte** mean TEST reset-window advantage for TAC106
against Transformer107 and a **2.2673x** faster mean recorded training time
for Transformer107. This is a source-reported descriptive tradeoff, **not** a
pre-registered or FLOP-matched architecture result. Source replay and
independent scorer/target-hash authentication remain open.

`wil_rbs_ledger.py` is a POSIX-local JSONL experimental ledger. Each appended
record includes a canonical SHA-256 digest, a previous event digest, and its
own event digest. Reads verify the whole chain and cross-record references;
appends take a cooperative POSIX file lock and fsync. For a *trusted*
tamper-detection guarantee, the head hash must be anchored outside the file
(e.g. in an independently reviewed Git commit). Anyone able to rewrite the
ledger and all hashes can otherwise rewrite history. This is **not** a signed
Woyengi Platform canonical ledger and does not authorize research promotion.

`wil_rbs_compute.py` handles explicitly **partial** projection MAC censuses,
converts MAC to FLOPs using 1 MAC = 2 FLOPs, and discloses excluded backward,
optimizer, attention, routing and memory operations. A PyTorch partial
profiler or projection census must never be labeled `end_to_end_training`.
No certified GPU/CPU training-FLOP collector was implemented in this version.

The project-specific TAC-OSM scientific gates and Woyengi constitutional
state/evidence boundaries remain separate and unchanged. This code belongs
in research infrastructure, not the platform kernel, and is unmerged until
its PR/CI/reviewer requirements are satisfied.
