# Veritas Real-Evidence Utility Restoration

Flagship HUD/DataVendor sample for Woyengi Intelligence.

## Demonstration thesis

The agent is not asked to produce a plausible incident explanation. It must investigate source-grounded evidence, perform a safe state-changing restoration sequence, compute reliability impact, and file an evidence-backed report. The reward is computed from authoritative environment state and action history.

## Source grounding

- ACTIVSg2000: synthetic 2000-bus power-system case; the publisher states it is entirely synthetic and free for commercial/non-commercial use.
  https://electricgrids.engr.tamu.edu/electric-grid-test-cases/activsg2000/
- DOE OE-417 Annual Summaries: reported electric emergency incidents/disturbances; the Open Energy Data Portal identifies the dataset as public domain.
  https://openenergyhub.ornl.gov/explore/dataset/oe-417-annual-summaries/
- EIA Form EIA-861 Reliability: non-momentary interruption data including SAIDI and SAIFI; EIA publishes CAIDI in its reliability tables.
  https://www.eia.gov/electricity/data/eia861/
- EIA reliability explainer: https://www.youtube.com/watch?v=oVH9L0fCMTU
- DOE OE-417 reporting reference: https://doe417.energy.gov/

The package stores normalized evidence and provenance. It does not redistribute upstream videos or copyrighted documents.

## What is synthetic

The operational episode state (faulted feeder F17, alternate A4, load restoration and episode telemetry) is a controlled synthetic world. The source datasets ground the ontology, historical event profile, simulator semantics, metrics and reporting workflow. They are not misrepresented as the hidden labels of the synthetic episode.

## HUD quickstart

```bash
uv tool install hud --python 3.12 --with anthropic
hud set HUD_API_KEY=YOUR_KEY
cd demos/hud/real-evidence-utility
hud eval tasks.py claude --gateway --full
hud build
hud deploy
hud sync tasks veritas-real-evidence-utility
```

For the strongest submission evidence, run both a successful trajectory and a deliberately unsafe trajectory. The latter must receive zero reward because the verifier rejects switching before isolation.

## Validation boundary

The repository commit proves the environment/taskset source is present. A HUD-hosted job ID, trace ID and model success rate must only be claimed after the commands above are actually executed against a HUD account.
