# Visual QA CI flake handoff

Issue #18. Dedicated integration-fix lane, separate from P0 feature ownership.

Change: harden `apps/woyengi/test/visual-qa.mjs` Chrome startup without skipping or weakening visual/accessibility assertions. The browser now binds CDP explicitly to loopback, avoids `/dev/shm` startup pressure, captures bounded stdout/stderr diagnostics, detects early process exit, and allows a bounded 20s readiness window under hosted-runner contention. App readiness also detects early process failure.

Falsifier/evidence: repeated P0 CI failures timed out at `/json/version` while all feature-lane tests passed. Acceptance is the normal PR CI ladder, including the unchanged visual assertions and full `pnpm test:all`.

No P0 package lane files are modified. No release/readiness claim is made until CI passes.
