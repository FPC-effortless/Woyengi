# Visual QA CI flake v2 handoff

Follow-up to issue #18 after a second hosted-runner failure reproduced under heavy `node --test` contention despite the first readiness hardening.

The failure remained isolated to Chrome publishing the CDP `/json/version` endpoint. Chrome stayed alive and only emitted DBus diagnostics; all package tests, including the new WorldBundle semantic falsifiers, passed.

This follow-up preserves every visual/accessibility assertion and changes only browser startup/readiness:
- process-aware monotonic timeout instead of a fixed attempt count;
- 60-second CDP readiness budget under concurrent hosted tests;
- extra background-service suppression;
- CI-only `--no-sandbox` / `--disable-setuid-sandbox` on the isolated ephemeral GitHub runner, avoiding Linux sandbox startup stalls; local QA keeps the normal sandbox;
- app readiness remains process-aware with a 30-second bound.

Acceptance requires the normal full PR CI, especially `pnpm test:all`; a targeted browser-only pass is insufficient.
