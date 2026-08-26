# Verification Ladder

Run the cheapest check that can falsify the current step, then expand scope as confidence grows.

## Woyengi implementation ladder

1. Targeted public-behavior test or minimal reproduction.
2. `pnpm typecheck`
3. `pnpm boundaries`
4. `pnpm test:all`
5. `pnpm benchmark` when behavior can affect state/reconstruction/adversarial semantics.
6. `pnpm prod:check` for production-impacting changes.
7. `pnpm prod:release` only for an actual release candidate and only when prerequisite human QA/evidence is ready.

Do not report a command as passed unless it was actually run.

## RL environment ladder

1. deterministic unit checks for state/action/transition semantics;
2. verifier tests including negative/adversarial cases;
3. seeded episode replay;
4. baseline policy sanity checks;
5. reward-hacking/leakage tests;
6. held-out task distribution evaluation;
7. reproducibility from a clean environment.

## Research / experiment ladder

1. sanity check on data/configuration;
2. baseline reproduction;
3. primary experiment;
4. ablation/counterfactual;
5. seed/variance or sensitivity check where material;
6. artifact/config capture;
7. independent interpretation against the original hypothesis.

## Evidence record

Record inputs, versions, commands, outputs/metrics, failures, exceptions, and anything not run. A green test suite is evidence for tested behavior, not authority to alter unrelated canonical or external state.
