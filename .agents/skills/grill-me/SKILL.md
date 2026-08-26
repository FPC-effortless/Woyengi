---
name: grill-me
description: Stress-test an idea or decision through grounded questions, recommendations, countercases, and failure modes.
---

# grill-me

Invoke the `grilling` method without requiring repository documents first.

The agent must do fact-finding that can reasonably be done itself. Ask the user for decisions, not searchable facts.

For each high-leverage question provide:
- why the decision matters;
- recommended choice based on current evidence;
- strongest countercase;
- what observation would change the recommendation.

For Woyengi or RL/research ideas, explicitly test whether the proposal creates an invariant collision, verifier loophole, leakage path, or unfalsifiable claim. Do not treat novelty or enthusiasm as evidence.
