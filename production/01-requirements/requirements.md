# Production requirements evidence

The authoritative scope is `prd.json`; the architectural invariants are `CONSTITUTION.md`. A release run must fail when a required artifact is absent or malformed. The PLAT-040 gate requires every prerequisite ticket (PLAT-001 through PLAT-039) to pass and requires exact, timestamped human QA acknowledgement. PLAT-040 itself is excluded from that prerequisite query because the successful release gate is evidence used to complete it.
