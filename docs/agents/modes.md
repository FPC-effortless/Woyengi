# Agent Work Modes

Select the mode before applying a skill. A task can cross modes, but each phase should have one primary mode.

## Product engineering

Use for Woyengi code, product behavior, infrastructure, migration, operations, or domain packages.

Required frame:
1. reconstruct repository/ticket/spec context;
2. identify constitutional invariants and authority boundaries;
3. state the user-visible or operational outcome;
4. choose the smallest behavioral seam that can fail;
5. implement on a branch/sandbox;
6. verify from targeted checks outward;
7. review against standards, spec, invariants, and evidence;
8. propose through a PR; reconcile any consequential effects separately.

## RL environment construction/evaluation

Use for training worlds, benchmarks, agent tasks, verifier design, synthetic/real data fusion, and capability packages.

Required frame:
1. capability being trained/measured;
2. hidden ground truth and what the policy can observe;
3. state, actions/tools, transition dynamics, budgets, termination;
4. task distribution and adversarial cases;
5. verifier/reward and anti-gaming checks;
6. realism/data provenance and train/test leakage controls;
7. baseline agents and failure modes;
8. reproducible evaluation artifacts and versioned environment contract.

Do not treat reward as ground truth. Prefer an independent verifier or executable outcome whenever the domain permits it.

## Research / experiment

Use for architecture hypotheses, VOPSD-style learning experiments, model experiments, literature work, and empirical comparisons.

Required frame:
1. falsifiable hypothesis;
2. strongest relevant baseline;
3. variables, controls, datasets/models, and compute assumptions;
4. independent metric/verifier;
5. ablation or counterfactual capable of falsifying the mechanism;
6. reproducible commands/configuration;
7. result with uncertainty and failure cases;
8. decision update: supported, weakened, rejected, or still unresolved.

## General workflow

For work that fits none of the above, retain the same discipline: explicit outcome, evidence, reversible execution where possible, verification, and a durable handoff.
