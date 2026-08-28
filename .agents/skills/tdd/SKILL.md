---
name: tdd
description: Use red-green-refactor at explicit behavioral seams with independent expected outcomes and minimal test/implementation surfaces.
---
# tdd

Before implementation, agree on the seam being tested: public API, port, reducer, verifier, projection, CLI behavior, environment transition, or experiment invariant.

Cycle:
1. RED: add the smallest test/falsifier that fails for the intended reason.
2. GREEN: apply the universal minimality ladder and make the smallest coherent change that satisfies it.
3. REFACTOR: improve structure without changing behavior and without speculative abstraction.
4. Expand verification scope only after the local loop is trustworthy.

Avoid tests that merely restate implementation details or compute expected values using the same code under test. Non-trivial new logic retains at least one runnable check; a trivial stdlib/native substitution introducing no new behavior need not add a ceremonial test if existing verification covers it.

For Woyengi semantics, favor tests that expose replay, bitemporality, authority/confidence separation, conflict visibility, permission boundaries, and external-effect handling. For RL environments, test transition and verifier semantics independently of the policy.
