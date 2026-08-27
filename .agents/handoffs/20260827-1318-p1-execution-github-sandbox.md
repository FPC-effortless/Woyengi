# Handoff — P1 Execution + GitHub + Sandbox Planning

Date: 2026-08-27  
Task: issue #15  
Branch: `plan/p1-execution-github-sandbox`  
Work mode: product engineering **planning only**  
Lifecycle completed: `wayfinder -> to-spec -> to-tickets -> handoff`

## Outcome / current state

Planning for #15 is complete and implementation remains intentionally blocked until P0 acceptance.

Created only the issue-owned planning artifacts:

- `docs/specs/p1-execution-github-sandbox.md`
- `docs/tickets/p1-execution-github-sandbox/README.md`
- `docs/tickets/p1-execution-github-sandbox/P1-EXE-001-durable-governed-execution.md`
- `docs/tickets/p1-execution-github-sandbox/P1-EXE-002-github-provider.md`
- `docs/tickets/p1-execution-github-sandbox/P1-EXE-003-isolated-sandbox.md`
- `docs/tickets/p1-execution-github-sandbox/P1-EXE-004-compute-runtime-integration.md`
- `docs/tickets/p1-execution-github-sandbox/P1-EXE-005-live-execution-api.md`
- `docs/tickets/p1-execution-github-sandbox/P1-EXE-006-coding-agent-tracer.md`
- this unique handoff file.

No source code, `prd.json`, `progress.txt`, shared ADR, or another planning lane's files were edited.

## Reconstructed seams used

Read and planned against:

- `AGENTS.md`
- `agent.md`
- `CONSTITUTION.md`
- `docs/architecture.md`
- `docs/specs/p0-ecosystem-alignment.md`
- `docs/adr/0003-governed-execution-and-effects.md`
- `docs/agents/modes.md`
- `docs/agents/verification.md`
- `.agents/skills/wayfinder/SKILL.md`
- `.agents/skills/to-spec/SKILL.md`
- `.agents/skills/to-tickets/SKILL.md`
- `.agents/skills/handoff/SKILL.md`
- issue #6 parent execution protocol
- issue #14 durable-state/auth planning scope
- issue #16 realtime/shell planning scope
- `packages/effects/src/index.ts`
- `packages/effects/test/governed-execution.test.ts`
- `packages/permissions/src/index.ts`
- `packages/harness/src/index.ts`
- `packages/compute/src/index.ts`
- `packages/connector-sdk/src/index.ts`
- `services/compute-node/index.ts`
- `services/runtime/src/index.ts`
- `services/platform-api/src/index.ts`
- root `package.json` verification commands.

## Key decisions

1. **Reuse the existing governed execution spine.** P1 does not create a second truth/execution model. `ActionIntent`, expected effect classes, manifest, receipt, observations, reconciliation, evidence, verification and acceptance remain canonical.
2. **Add orchestration/durability around the effects model.** The existing engine is in-memory; P1-EXE-001 owns the minimum validated restore/rehydration seam needed for restart.
3. **Uncertain external writes are reconcile-only.** A request that may have reached GitHub is never automatically resubmitted after timeout/restart. Durable claim + fingerprint precedes dispatch; canonical reread settles `CONFIRMED/DIVERGED/UNCERTAIN`.
4. **Do not use the pull-oriented connector SDK as an outbound authority abstraction.** A dedicated `packages/github-connector/**` adapter owns GitHub read/mutation/reconciliation behavior.
5. **Credentials are opaque/non-recordable.** Execution carries binding and credential-lease IDs; credential material is materialized only inside the provider transport boundary and never enters journals/evidence/realtime/sandbox fixtures.
6. **Coding execution is sandboxed.** Untrusted repo commands do not run on the host process. Sandbox is default-no-network, non-root, no privileged/Docker socket/host namespaces, budgeted and content-bound.
7. **Compute observations remain observations.** Preserve `HostedComputeObservation.observationOnly=true`, `acceptedTruth=false`, `semanticMutation=false`.
8. **Generic job retry is unsafe for ambiguous external effects.** Runtime integration must distinguish safe runtime retry from `RECONCILE_ONLY` recovery.
9. **Cross-lane integration is via ports.** #14 supplies durable principal/session/persistence adapters; #16 consumes execution read/event/sandbox-session behavior. No shared implementation files are required.
10. **Coding tracer is issue -> governed sandbox/tests -> content-bound evidence -> GitHub branch/commit/PR -> canonical reconciliation -> independent verification -> acceptance.** Failed required tests/evidence or revoked authority cause zero publish calls.

## Ticket dependency order and future ownership

1. `P1-EXE-001` — `packages/execution/**` plus the narrowly owned effects restore seam/tests.
2. `P1-EXE-002` — `packages/github-connector/**`.
3. `P1-EXE-003` — `packages/sandbox/**`.
4. `P1-EXE-004` — `services/compute-node/**`, `services/runtime/**`.
5. `P1-EXE-005` — `services/platform-api/**`.
6. `P1-EXE-006` — `packages/coding-agent/**`.

`P1-EXE-002` and `P1-EXE-003` can be parallelized only after P1-EXE-001 is merged. P1-EXE-006 waits on all upstream work plus #14's durable Work/principal behavior.

## Falsifiers carried forward

The ticket set explicitly covers:

- duplicate external effects;
- same idempotency key with changed request fingerprint;
- GitHub 2xx with divergent canonical reread;
- GitHub timeout after provider actually applied write;
- unresolved/uncertain GitHub write across repeated restart;
- sandbox host path/symlink/Docker socket/privilege/network escape;
- CPU/memory/PID/time/output budget breach;
- restart without sandbox/process duplication;
- cancellation before and after ambiguous provider effects;
- authority/session revocation at the actual effect boundary;
- cross-workspace leakage;
- reordered/duplicate delivery projections;
- missing/corrupt/truncated evidence;
- provider self-verification without an independent verifier;
- secret material appearing in logs/journals/evidence/events/sandbox input;
- failed required tests causing any GitHub publish call.

## Commits created before this handoff

- spec: `f163a5ea28635104e6b1246ddba3f10f839f008f`
- P1-EXE-001: `c4b2805e2b89aa72a53b0ef6e5abb248da51b582`
- P1-EXE-002: `2d3506dc9ba24a1166810f4245c09014d43e619d`
- P1-EXE-003: `1ab9caf53d5ff935166265efa7b7d56f4a3a5ed7`
- P1-EXE-004: `484c454bee4afd902132ff25c9e463a869a5c324`
- P1-EXE-005: `ab1638898d31b8639e09b742402466b57481091a`
- P1-EXE-006: `9205c339388baca373422a32ab4b76fd86634ea9`
- ticket index: `3c2c7d729833cf4067940530e398a790a92df0bb`

No PR was opened because the user asked for planning-only work on the assigned branch.

## Tests / commands / metrics

No source tests were run because this lane was explicitly planning-only and changed Markdown planning artifacts only. The repository verification ladder was read so every future ticket contains targeted tests plus `pnpm typecheck`, `pnpm boundaries`, `pnpm test:all`, and adversarial/production gates where applicable.

A final branch-diff ownership check should confirm the branch differs from its starting commit only at the issue-owned spec/ticket/handoff paths.

## Evidence / failures

Evidence: the current code already demonstrates that provider success alone cannot be accepted, uncertain external effects require review, capability authority is default-deny/workspace-scoped, and hosted compute output is observation-only.

No planning blocker was found that requires editing P0 or another lane today.

## Authority / effect status

- No live credentials were read, requested or stored.
- No GitHub provider mutation, sandbox process, external effect or semantic effect was executed.
- Planning commits affect repository documentation only on the assigned branch.
- P1 implementation remains blocked on P0 acceptance.

## Unresolved risks

1. Current `GovernedExecutionEngine` has in-memory aggregates and needs a narrow validated restore seam.
2. Current engine exposes one manifest-level `ExecutionReceipt`; implementation must not silently redefine it when a coding run has multiple external effects.
3. GitHub server-side idempotency is inconsistent across relevant mutation APIs; exact marker/precondition strategies require provider-adapter tests.
4. Strong hostname egress allowlisting is not inherent in Docker; initial sandbox should remain no-network unless enforcement is demonstrably available.
5. Generic runtime retry semantics conflict with ambiguous external writes and must be guarded/reclassified.
6. Credential broker concrete ownership depends on the durable/security adapter selected around #14; its public non-recordability contract is fixed here.
7. P0 `OutcomeContract` must remain broader than the existing execution `VerificationContract`; implementation must map, not collapse, those meanings.

## Exact next action

1. Integration owner reviews/accepts this planning lane and waits for P0 acceptance.
2. After P0 is explicitly accepted, assign `P1-EXE-001` to one implementation agent with the ticket's future exclusive ownership.
3. That agent begins with the ticket's falsifier tests, especially crash-after-dispatch / reconcile-only recovery, before implementing the coordinator or effects restore seam.
4. Do not start P1-EXE-002..006 out of dependency order or bypass a missing upstream public interface by editing another lane's files.