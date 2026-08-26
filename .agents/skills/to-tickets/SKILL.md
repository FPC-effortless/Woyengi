---
name: to-tickets
description: Split an approved spec into dependency-aware tracer-bullet tickets that can be completed in fresh contexts.
---

# to-tickets

Prefer vertical slices that produce an observable, verifiable increment. Each ticket must stand alone for a fresh agent context.

Include:
- outcome/Outcome Contract;
- prerequisites and blockers;
- state inputs/outputs or experiment inputs/outputs;
- public seam being changed;
- explicit non-goals;
- tests/falsifiers and required verification;
- evidence to capture;
- authority/external-effect constraints;
- rollback/replay considerations if material.

If the desired slice is impossible because the code lacks a clean seam, create a narrow preparatory refactor ticket first. Avoid layer-by-layer tickets that leave the system unverifiable for long periods.
