---
name: diagnosing-bugs
description: Diagnose bugs with a red-capable loop, caller tracing, ranked hypotheses, and root-cause placement.
---
# diagnosing-bugs

1. Reconstruct the failing context and identify the smallest observable symptom.
2. Build the tightest loop that can turn red reliably before proposing causes: targeted test, minimal reproduction, replay, trace, or verifier case.
3. Trace the real flow end to end and inspect material callers/sibling paths of the seam you may change.
4. Rank falsifiable hypotheses; instrument only enough to distinguish them and change one causal variable at a time.
5. Fix the shared root cause rather than only the ticket's symptom; one correct common-seam fix is smaller and safer than repeated sibling guards.
6. Add a regression check at the public or architectural seam that should have prevented the bug.
7. Run the relevant verification ladder and record evidence.

For state/reconstruction failures, check canonical history, valid vs transaction time, provenance, authority, conflict retention, identity operations, and deterministic replay before blaming disposable indexes. If replayed canonical records differ from a materialized projection, treat the projection as suspect first.
