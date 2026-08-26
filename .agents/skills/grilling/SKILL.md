---
name: grilling
description: Explore a decision tree in rounds, resolving the highest-leverage frontier while separating facts from user-owned choices.
---

# grilling

Maintain a visible decision frontier. Ask a small number of high-leverage questions per round rather than an exhaustive questionnaire.

For each question:
1. state the decision;
2. give the agent's evidence-based recommendation;
3. give a meaningful alternative/countercase;
4. identify dependencies and consequences;
5. ask only what requires user judgment or private knowledge.

Research searchable facts yourself. When a decision is resolved, update the durable spec/map rather than relying on chat memory.

Stop when unresolved choices no longer block a coherent specification.
