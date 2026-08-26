---
name: to-spec
description: Turn a sufficiently settled conversation or research result into an implementation-ready, evidence-aware specification.
---

# to-spec

Do not restart an interview. Synthesize the current decision state and explicitly mark unresolved items.

A spec should contain:
- problem and intended outcome;
- scope and non-goals;
- reconstructed context and assumptions;
- selected work mode;
- governing invariants/authority constraints;
- state/effect model;
- key implementation decisions and rejected alternatives;
- migration/replay/rollback implications where relevant;
- test, falsification, and evidence seams;
- acceptance criteria;
- human QA/authority gates;
- unresolved risks.

For RL environments add environment contract, task distribution, hidden ground truth, action/tool surface, verifier/reward, leakage controls, baselines, and eval protocol. For research add hypothesis, baselines, variables, ablations, metrics, compute/data assumptions, and reproducibility requirements.
