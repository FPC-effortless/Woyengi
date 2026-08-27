# P1C-003 — Coding-first multi-client E2E and failure/reconnect proof

Status: BLOCKED — planning only until P0, P1 lane dependencies, P1C-001, and P1C-002 are accepted
Parent planning issue: #16
Spec: `docs/specs/p1-realtime-shell-coding.md`
Work mode: Product engineering

## Outcome Contract

Prove the complete coding-first reference vertical through public seams, not mocks of the architectural boundary:

```text
GitHub issue
-> shared WorkInstance / WorkEpisode
-> separately granted AgentPrincipal
-> governed sandbox execution
-> code + tests
-> evidence
-> independent verification / review
-> governed PR publication
-> accepted outcome projection
```

Two authorized human clients must observe the same durable Work history live. The proof must include forced disconnect/reconnect, human takeover/handoff, execution failure/uncertain external-effect recovery, and resume without duplicate GitHub effects.

This ticket is a conformance/E2E tracer. It does not own production fixes: any discovered defect is routed back to the ticket/lane that owns the failing public seam.

## Prerequisites / blockers

Hard blockers:

- P0 accepted under #6.
- P1 lane A (#14) implementation accepted.
- P1 lane B (#15) implementation accepted.
- P1C-001 accepted.
- P1C-002 accepted.

The test must consume lane A/B public package/API seams only. It must not import private adapters, Docker internals, GitHub credential stores, or another lane's test-only implementation helpers unless that helper is intentionally exported as a stable public conformance fixture seam.

## Future exclusive file ownership

The future coding agent for this ticket may create/edit ONLY:

- `benchmarks/conformance/test/p1-coding-live.test.ts` (new)
- `benchmarks/conformance/fixtures/p1-coding-live/issue.json` (new)
- `benchmarks/conformance/fixtures/p1-coding-live/repository/README.md` (new)
- `benchmarks/conformance/fixtures/p1-coding-live/repository/src/example.ts` (new)
- `benchmarks/conformance/fixtures/p1-coding-live/repository/test/example.test.ts` (new)

No production source file is owned by P1C-003.

If the E2E exposes a product defect, leave the failing test/evidence in this ticket and open/route the implementation correction to the current owner of that public seam. Do not broaden this ticket's file ownership ad hoc.

## Fixture contract

The fixture represents a small deterministic coding task that is meaningful enough to exercise issue parsing, code modification, tests, evidence, verification/review, and PR publication semantics without network dependence in the default conformance run.

`issue.json` must contain fixture-safe provider-neutral issue metadata, including:

- stable issue reference;
- repository reference;
- title/problem statement;
- acceptance criteria;
- base revision identity;
- allowed operation scope.

The repository fixture starts with at least one failing behavior or missing feature and a deterministic test oracle. The task must require a real code change and produce an inspectable diff.

Lane B is responsible for mapping its GitHub connector/sandbox implementation onto this fixture through its public testable provider boundary. This ticket must not fake the governed execution/effect spine in the shell.

## Initial state inputs

- seeded account with Personal and Organization Workspace or equivalent accepted lane-A fixture setup;
- Human A, Human B, and separately granted coding `AgentPrincipal`;
- lane-A durable Work/session state;
- fixture GitHub issue/repository through lane B's public provider boundary;
- live shell entrypoint from P1C-002;
- realtime SSE delivery from P1C-001;
- independent verifier/reviewer surface from the existing governed verification spine/lane B contract.

## Required state outputs

The E2E must retain correlated identifiers for:

- workspace;
- WorkInstance;
- WorkEpisode;
- coding activity/assignment;
- agent principal;
- execution/sandbox run;
- trace;
- code/diff artifact/evidence;
- tests;
- independent verification/review;
- external PR effect/request;
- reconciled PR reference;
- accepted outcome / semantic state transition where required by the established execution contract.

The test must assert semantic ordering, not just presence of unrelated records.

## Public seam exercised

The E2E must start/drive the product using public entrypoints/contracts:

1. lane A session/workspace/work public API/ports;
2. lane B coding execution/GitHub/sandbox public API/ports;
3. P1C-001 transport seam through the live server;
4. P1C-002 shell HTTP/SSE/command surface.

A direct import of an internal storage map, GitHub adapter implementation file, sandbox process implementation, or hidden authorization state invalidates the tracer.

## Happy-path scenario

1. Establish Human A and Human B sessions with explicit access to the same organization workspace.
2. Establish a separately granted coding AgentPrincipal with only the fixture task's required capabilities.
3. Import/select the fixture issue through lane B's public GitHub/provider contract.
4. Create/link the corresponding `WorkInstance`; start a bounded `WorkEpisode`.
5. Assign coding activity to the AgentPrincipal with an authorization reference.
6. Open live shell sessions for Human A and B and bootstrap at causal cursors.
7. Start governed sandbox execution through the public coding execution contract.
8. Observe ordered durable progress in both live clients without exposing provider credentials/sandbox secrets.
9. Agent changes code and runs the deterministic tests.
10. Persist/reference execution evidence and diff/test artifacts.
11. Run independent verification/review. Test success alone is insufficient.
12. After required authority/gates, attempt PR publication as a governed external effect.
13. Reconcile the provider result to exactly one PR reference.
14. Surface the PR/verification/accepted outcome live to both authorized clients.
15. Assert all relevant stages share the expected Work/episode/execution trace relationships.

## Mandatory interruption / recovery scenario

During a second run or controlled branch of the same fixture:

1. Disconnect Human A's SSE connection after a known durable cursor while agent execution continues.
2. Emit multiple durable progress/evidence changes.
3. Reconnect Human A from its last cursor and assert every later authorized event is recovered in order with no duplicate rendered timeline item.
4. Human B performs an authorized takeover or suspend using the current Work version.
5. Assert Work assignment transition is durable and separately correlated with execution suspend/cancel behavior.
6. Force lane B's provider boundary into an ambiguous external-write outcome for PR publication or another chosen consequential GitHub write: request may have reached provider but response is lost/unknown.
7. Assert UI/execution state becomes `uncertain`/reconciliation-required and blind retry is blocked.
8. Reconcile against provider state using stable idempotency/trace identity.
9. Assert at most one external PR/effect exists.
10. Resume or hand back to the AgentPrincipal, finish remaining verification/review, and reach the same accepted outcome without duplicated Work transitions or external effects.

## Falsifiers / assertions

The test fails if any of these occur:

1. **Cross-workspace leakage:** a session from an unauthorized workspace can see Work, presence, execution, evidence, or PR metadata.
2. **Agent grant leakage:** AgentPrincipal acts with Human A's grants or accesses an ungranted provider capability.
3. **Cursor loss:** reconnect skips an authorized durable event after the last applied cursor.
4. **Duplicate render:** replayed boundary event creates two logical activity/timeline entries.
5. **Presence replay:** stale presence survives process restart/reconnect as durable history.
6. **Stale takeover:** a stale expected Work version is accepted silently.
7. **Takeover shortcut:** UI assignment change silently mutates execution state without the governed execution-control seam.
8. **Effect replay:** reconnect/resume causes the same GitHub write to be issued twice.
9. **Uncertain-effect retry:** ambiguous provider outcome can be blindly retried before reconciliation.
10. **Evidence shortcut:** execution/test success becomes accepted outcome without required independent verification/review.
11. **PR shortcut:** PR reference appears as accepted outcome without the configured acceptance boundary.
12. **Secret leakage:** browser/SSE/log evidence contains GitHub credential, session secret, Docker/process secret, environment secret, internal capability grant, or private evidence body/locator beyond authorized metadata.
13. **Trace break:** Work, execution, evidence, verification/review, and PR effect cannot be correlated through the required IDs.
14. **Restart loss:** durable Work/execution history disappears after server restart.
15. **Replay effect:** rebuilding state/replaying events invokes a command/provider write.

## Test implementation constraints

- deterministic fixture; default test must not require public GitHub network access;
- no real credentials/secrets;
- sandbox/provider failure is injected through lane B's accepted public test/fault seam;
- wait conditions use bounded deterministic polling/event waits, never arbitrary long sleeps;
- assertions inspect public responses/events/durable exported evidence, not private maps;
- test cleans temporary repositories/processes/servers even on failure;
- test records enough fixture-safe IDs to reconstruct the trace.

## Required verification

Run and record:

```bash
node --test benchmarks/conformance/test/p1-coding-live.test.ts
node --test packages/realtime/test/collaboration-hub.test.ts packages/realtime/test/sse-delivery.test.ts
node --test apps/woyengi/test/shell.test.ts apps/woyengi/test/live-shell.test.ts
pnpm typecheck
pnpm boundaries
pnpm test:all
pnpm prod:check:fast
```

Run `pnpm benchmark` only if the implementation changes benchmarked state/reconstruction semantics or the reviewer requires it; the E2E itself is a conformance tracer, not a license to change the core benchmark threshold.

The global production gate must be reported accurately. Unrelated human acceptance/release blockers remain blockers.

## Evidence capture

The implementation handoff/PR must include a fixture-safe trace table:

| Stage | Required identifier/evidence |
| --- | --- |
| Issue | issue/repository/base revision ref |
| Work | workspace + WorkInstance + WorkEpisode + assignment refs |
| Execution | execution ID + trace ID + sandbox/provider identity class |
| Code/tests | diff/artifact ref + test evidence ref/result |
| Verification/review | independent verification/review ref/result |
| External effect | idempotency/effect request identity + reconciliation state |
| PR | exactly one reconciled PR ref |
| Outcome | accepted-outcome/semantic state ref if required by governing contract |
| Reconnect | last cursor before drop + first/later cursors after reconnect |
| Takeover | old/new assignment version + authorization ref |

Also record:

- exact RED falsifier when first added;
- final targeted/full command outputs;
- proof that the uncertain-effect branch produced at most one provider-side effect;
- two-client no-leakage/no-duplicate assertions;
- unresolved limitations.

## Authority / external-effect constraints

- Human A, Human B, and AgentPrincipal remain distinct principals.
- The agent has only the minimum fixture task capabilities.
- Browser controls never bypass backend authorization.
- PR publication is a consequential external effect and requires lane B's idempotency/reconciliation semantics.
- Test/review/verification authority remains separate from execution success.
- Replay/reconnect/restart paths are read/reconstruction operations and must never republish the PR or repeat another consequential effect.

## Rollback / replay

This ticket adds only conformance fixtures/tests. Rollback removes the test artifacts and has no production-state effect.

The E2E explicitly proves replay/restart from durable state. Replaying the trace must reconstruct the same Work/execution/evidence/outcome relationships without reissuing provider writes.

## Completion gate

Complete only when the happy path and mandatory interruption branch both pass through public seams, at-most-one external effect is proven under ambiguous recovery, the multi-client leakage/reconnect assertions pass, and no production source was edited by this ticket.