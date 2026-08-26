---
name: diagnosing-bugs
description: Diagnose bugs by first building a red-capable feedback loop, then testing ranked hypotheses.
---

# diagnosing-bugs

1. Reconstruct the failing context and identify the smallest observable symptom.
2. Build the tightest loop that can turn red reliably before proposing causes: targeted test, minimal reproduction, replay, trace, or verifier case.
3. Rank falsifiable hypotheses. Instrument only enough to distinguish them.
4. Change one causal variable at a time.
5. Fix the cause, not the symptom.
6. Add a regression test at the public or architectural seam that should have prevented the bug.
7. Run the relevant verification ladder and record evidence.

For state/reconstruction failures, check canonical history, valid vs transaction time, provenance, authority, conflict retention, identity operations, and deterministic replay before blaming disposable indexes. If replayed canonical records differ from a materialized projection, treat the projection as suspect first.
