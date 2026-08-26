---
name: codebase-design
description: Design deep modules and stable seams that hide complexity while preserving Woyengi's constitutional boundaries.
---

# codebase-design

Evaluate modules by interface cost versus complexity hidden. Prefer high-leverage, stable public seams and adapters around replaceable providers.

Questions:
- Does the interface express policy or leak mechanism?
- Is invariant logic localized?
- Can storage/search/model/harness providers change behind stable contracts?
- Can the module be tested without knowing its internals?
- Are composition roots narrow rather than omnipotent?
- Are state projection, verification, authority, replay, and external-effect boundaries explicit?
- Does the design preserve the ability to rebuild disposable materializations from canonical history?

Use these terms consistently: interface, depth, seam, adapter, port, composition root, locality, leverage.
