---
name: tdd
description: Use red-green-refactor at explicit behavioral seams, with independent expected outcomes where possible.
---

# tdd

Before implementation, agree on the seam being tested: public API, port, reducer, verifier, projection, CLI behavior, environment transition, or experiment invariant.

Cycle:
1. RED: add one test/falsifier that fails for the intended reason.
2. GREEN: make the smallest change that satisfies it.
3. REFACTOR: improve structure without changing behavior.
4. Expand verification scope only after the local loop is trustworthy.

Avoid tests that merely restate implementation details or compute expected values using the same code under test.

For Woyengi semantics, favor tests that expose replay, bitemporality, authority/confidence separation, conflict visibility, permission boundaries, and external-effect handling. For RL environments, test transition and verifier semantics independently of the policy.
