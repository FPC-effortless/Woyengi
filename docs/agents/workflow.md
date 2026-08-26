# Evidence-First Agent Workflow

The adapted skill pack uses Matt Pocock's decomposition discipline while adding Woyengi's reconstruction, authority, verification, and reconciliation requirements.

## Routing

- Unknown external facts: `research`
- Missing product/architecture decisions: `grill-with-docs` or `grill-me`
- Very large/foggy initiative: `wayfinder`
- Settled direction: `to-spec`
- Multi-session implementation: `to-tickets`
- Coding: `implement` with `tdd`
- Bug: `diagnosing-bugs`
- Incoming issue/PR: `triage`
- Architecture health: `improve-codebase-architecture`
- Vocabulary/model boundary: `domain-modeling` + `codebase-design`
- Review: `code-review`
- Human-only setup/secrets: `wizard`
- Context transfer: `handoff`

## Work state

Each meaningful task should be reconstructable from durable artifacts rather than chat history. Prefer links/pointers to the ticket, spec, ADR, commit, experiment artifact, and evidence over copying them into multiple documents.

## Decision discipline

Agents own fact-finding, comparison, falsification, and recommendations. The user/authorized maintainer owns consequential product, architecture, policy, and authority decisions unless a pre-existing contract explicitly delegates them.

## Change discipline

For code, use a branch and public-behavior test/falsifier before broad implementation. For research, use a hypothesis and baseline before claiming mechanism. For RL environments, define the environment contract and verifier before optimizing policies against it.

## Closeout

A task is not complete merely because code runs or a model produces an answer. Closeout requires the relevant verification ladder, review, recorded evidence, unresolved-risk disclosure, and correct reconciliation/authority status.
