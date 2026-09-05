# DataVendor-facing summary

## Flagship: Evidence-Grounded Utility Restoration

Veritas turns heterogeneous operational evidence into an executable agent environment. The flagship sample combines a synthetic power-system world with source-grounded historical outage records, government reliability definitions, and procedure references.

The agent must:

1. inspect evidence;
2. distinguish historical/source context from episode telemetry;
3. isolate the faulted feeder;
4. perform safe restoration switching;
5. restore affected load;
6. compute reliability metrics from environment state;
7. file an incident report citing evidence.

The grader reconstructs the operational state from tool actions. It does not trust a status claim or the agent's narrative.

### Anti-shortcut properties

- Unsafe switching before fault isolation is a hard failure.
- Unknown/fabricated evidence IDs cannot satisfy the evidence requirement.
- The required customer count is tied to the selected source profile.
- Reliability metrics are computed by the environment rather than accepted from the agent.
- Source provenance and episode truth are explicitly separated.

### Source lineage

The source plan identifies ACTIVSg2000 as a synthetic 2,000-bus grid for physical-state simulation, DOE OE-417 as public-domain historical disturbance data, and EIA-861 as a reliability-data source. The current source manifest includes two concrete 2023 OE-417 discovery records: a January 23 severe-weather event affecting 41,000 customers and a January 25 severe-weather event affecting 60,958 customers.

### Claim boundary

The repository sample is source-grounded and locally reviewable. A hosted HUD model score, trace, or publication status is intentionally not claimed until an actual HUD evaluation is run.
