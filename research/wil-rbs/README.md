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
- Records are intended for append-only research ledgers. This CLI verifies a snapshot; it does not yet implement storage locking, Merkle commits, signatures, CI provenance, statistical uncertainty or a full dashboard.

## Historical example provenance

TAC106 and Transformer107 values are transcribed from GitHub research PRs #686 and #688. FUSION001 and matched GRU numbers are transcribed from the Woyengi Intelligence Labs research report `FUSION001_Compute_and_Timing_Audit.md` and comparison table from 2026-11-02; exact raw per-run receipts were not brought into this prototype. Historical examples intentionally do not claim verified parity or equal-cost training.

## Scope and next integrations

1. Recover all original individual-run receipts and per-seed scores from TAC-OSM and Fusion rather than reconstructing them from averages.
2. Add streaming JSONL append-only ledger, immutable checkpoint objects, independent signatures and provenance audit.
3. Add full training FLOP instrumentation, time-to-target curves, TTFT and cached decoding by hardware/workload.
4. Add queryable Pareto frontiers and uncertainty-aware reports, with distinct real-world scientific promotion handled by the original domain gates.

Research tracking: https://github.com/FPC-effortless/Woyengi/issues/67
