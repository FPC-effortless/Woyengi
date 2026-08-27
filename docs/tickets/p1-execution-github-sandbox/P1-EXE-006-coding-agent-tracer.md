# P1-EXE-006 — Coding-Agent Issue-to-Verified-PR Tracer Bullet

Status: **BLOCKED ON P0 ACCEPTANCE AND P1-EXE-001..005**  
Issue lane: #15  
Depends on: P1-EXE-001, P1-EXE-002, P1-EXE-003, P1-EXE-004, P1-EXE-005, lane #14 durable Work/principal adapters  
Provides: backend operational contract consumed by lane #16's coding E2E UI/transport

## Outcome contract

Deliver one end-to-end coding-agent operational path:

`GitHub issue -> durable WorkEpisode/accepted contract -> harness selection -> governed execution -> immutable repo snapshot -> isolated edit/test sandbox -> content-bound evidence -> authorized branch/commit/PR external effects -> canonical GitHub reconciliation -> independent verification/review -> accepted/rejected outcome`

Success means a deterministic fixture can complete this entire path through public package/service interfaces, while adversarial variants prove that failed tests, missing/corrupt evidence, authority revocation, ambiguous GitHub writes, sandbox failure and restart do not result in an unjustified publish or accepted outcome.

## Future exclusive file ownership

The implementation agent owns **only**:

- `packages/coding-agent/**` (new package directory, including its tests/fixtures).

All upstream packages/services, #14/#16 files, shared ADRs, `prd.json`, and `progress.txt` are read-only. Upstream deficiencies must be reported to the owning ticket as the minimum required public-contract change.

## Preconditions / blockers

1. P0 accepted and accepted `OperationalSystemSpec`/`OutcomeContract` public interfaces available.
2. P1-EXE-001 durable coordinator available.
3. P1-EXE-002 GitHub provider available.
4. P1-EXE-003 sandbox available.
5. P1-EXE-004 compute/runtime path available.
6. P1-EXE-005 live/read execution API seams available.
7. #14 durable WorkInstance/WorkEpisode + session/principal adapters available.
8. The test fixture uses a fake GitHub provider by default; no credential is required for the conformance E2E.

## Public operational contract

Expose a coding-agent orchestration contract similar to:

```ts
export interface CodingExecutionRequest {
  readonly workspaceId: string;
  readonly principalId: string;
  readonly sessionId: string;
  readonly workInstanceId: string;
  readonly workEpisodeId: string;
  readonly operationalSystemSpecRef: string;
  readonly outcomeContractRef: string;
  readonly githubBindingId: string;
  readonly repository: { readonly owner: string; readonly name: string };
  readonly issueNumber: number;
  readonly baseRef: string;
  readonly targetBranchNamespace: string;
  readonly budget: CodingExecutionBudget;
  readonly requiredTests: readonly RequiredTestAssertion[];
  readonly requiredEvidence: readonly RequiredEvidenceAssertion[];
}

export interface CodingExecutionResult {
  readonly executionId: string;
  readonly issue: GitHubIssueProjection;
  readonly repositoryInput: ContentBoundRepositoryInput;
  readonly patchEvidence?: ContentBoundEvidence;
  readonly testEvidence: readonly ContentBoundEvidence[];
  readonly githubEffects: readonly GitHubEffectProjection[];
  readonly verification: readonly IndependentVerificationProjection[];
  readonly outcome: AcceptanceProjection;
}
```

The implementation may split orchestration into stages, but callers cannot bypass governed execution to publish GitHub effects.

## Required stages

### 1. Resolve task and authority

- authenticate/resolve current principal/session;
- load durable WorkInstance/WorkEpisode and accepted P0 operational/outcome contract references;
- read GitHub issue through P1-EXE-002;
- bind issue/repository/base SHA to the WorkEpisode and execution correlation;
- run harness applicability/authority/budget/risk selection;
- create `ActionIntent` + expected effect plan.

### 2. Snapshot repository

- resolve base ref to exact commit SHA;
- obtain content-bound repo snapshot through GitHub provider;
- record immutable input identity as evidence/provenance;
- no broad GitHub credential enters the sandbox.

### 3. Edit/test in sandbox

- create sandbox with repo snapshot and strict policy;
- run the selected coding agent/tool procedure through compute/runtime;
- extract content-bound patch/tree output;
- run required tests in sandbox under the same/derived immutable input + patch identity;
- record stdout/stderr/test artifacts with digests and truncation state.

### 4. Pre-publish gate

Before any GitHub branch/commit/PR mutation:

- required tests must pass according to the outcome contract;
- required evidence must exist and validate by digest;
- current principal/session authority must still permit publish effects;
- budget/risk limits must still permit remaining effects;
- target branch must remain inside the authorized namespace;
- base/head preconditions must be checked.

A failed pre-publish gate means **zero GitHub mutation calls**.

### 5. Publish governed GitHub effects

Model branch update, commit publication and PR creation as explicit `EXTERNAL` expected effects with stable idempotency keys. For each:

- durable claim before mutation;
- one dispatch attempt;
- provider receipt/observation;
- canonical GitHub reread;
- `CONFIRMED/DIVERGED/UNCERTAIN` reconciliation.

Do not continue to dependent publish effects when an earlier required effect is `DIVERGED/UNCERTAIN` unless the accepted contract explicitly permits a safe path.

### 6. Independent verification and outcome

Independent verifier must validate at minimum:

- source issue/work/contract correlation;
- repo input base SHA;
- patch/tree digest;
- required test result digests and completeness;
- final GitHub branch/commit/PR canonical identities;
- reconciliation status for every external effect;
- budget/attempt constraints;
- no forbidden effect class;
- required evidence set.

Only then may existing governed acceptance produce `ACCEPTED` and any allowed verified semantic commit.

Provider self-check, model confidence, sandbox exit 0, or GitHub CI green alone are insufficient.

## Effect model for the tracer

Recommended expected effects:

- `RUNTIME`: sandbox lease/process/test execution and temporary streams;
- `EXTERNAL`: target branch create/update;
- `EXTERNAL`: commit publication/ref update as modeled by selected GitHub adapter;
- `EXTERNAL`: PR creation/update;
- optional `SEMANTIC`: Woyengi Work outcome/provenance proposal, committed only through accepted semantic-commit flow.

If GitHub commit + branch publication are atomically one provider operation in the chosen adapter, model their expected-effect boundary consistently and test the canonical identity. Do not pretend atomicity that the provider does not guarantee.

## Coding-agent authority restrictions

The agent receives only narrowly delegated execution authority:

- one workspace;
- one WorkEpisode/purpose;
- one repository/issue;
- allowed base ref + target branch namespace;
- enumerated GitHub mutation operations;
- explicit sandbox/network/budget constraints;
- bounded time/attempts;
- no org/repo administration, secrets, branch protection, destructive history rewrite or unrelated issues/PRs.

Agent authority must be strictly narrower than the delegating human/service grant.

## Required fixture

Create one deterministic fixture inside `packages/coding-agent/test/fixtures/**` containing:

- fake GitHub repository metadata with base commit/tree;
- one issue requesting a small deterministic code change;
- repository snapshot bytes/files;
- a deterministic coding-agent/tool fake that produces the expected patch;
- one required test that passes only after the patch;
- fake GitHub mutation/reconciliation transport;
- independent verifier fixture;
- accepted P0 operational/outcome contract fixture using the real public contract shape available after P0.

Also provide adversarial variants without changing production code paths.

## Non-goals

- user-facing shell/realtime UI owned by #16;
- broad autonomous software engineering loop;
- direct `git push` credential in the sandbox;
- merging the PR automatically;
- accepting an agent's own assertion as verification;
- production GitHub credentials in fixtures;
- force-push/destructive repo administration;
- bypassing Work/OutcomeContract/ActionIntent/effects.

## Falsifiers / tests first

Write the E2E test matrix before orchestration code:

1. happy path -> exactly one branch/commit/PR effect each (or documented atomic grouping), all canonically reconciled, independent verification passes, outcome accepted;
2. required test fails -> zero GitHub mutation calls, outcome not accepted;
3. test command exits 0 but required test artifact missing -> zero publish calls / verification rejected;
4. test evidence digest corrupt -> verification rejects;
5. sandbox output truncated where full evidence required -> verification rejects;
6. agent proposes target branch outside authorized namespace -> fail before GitHub mutation;
7. principal/capability revoked after tests but before publish -> zero publish calls;
8. base branch changed after repo snapshot -> GitHub precondition/reconciliation blocks unsafe publication;
9. branch mutation timeout after fake provider applied it -> restart/recovery canonical reread, mutation call count one;
10. PR creation timeout + inconclusive reread -> `UNCERTAIN`, no automatic second PR, outcome not accepted;
11. restart during running sandbox -> process not duplicated;
12. restart after tests but before publish -> evidence reused only if digests/contract still valid; authority rechecked;
13. cancellation during edit/test -> sandbox terminates and zero later publish calls;
14. cancellation after ambiguous PR write -> no retry, reconciliation continues;
15. GitHub returns 2xx but canonical commit/PR identity differs -> `DIVERGED`, outcome rejected;
16. provider self-verifier marks pass but independent verifier missing/fails -> outcome rejected;
17. budget exhausted after tests -> no publish call;
18. forbidden external effect present in accepted outcome contract -> no dispatch;
19. cross-workspace WorkEpisode/binding/repo attempt -> fail closed;
20. credential-shaped fixture never appears in sandbox input, output evidence, execution journal, event or error projection;
21. repeated identical API/client request -> no duplicate provider mutation;
22. same idempotency key reused with changed patch/target -> conflict before mutation;
23. accepted outcome records final canonical PR/commit evidence, not merely provider response IDs.

## Evidence required from implementation

The happy-path E2E must capture:

- exact WorkEpisode/contract refs;
- input issue and repo base SHA;
- sandbox image digest/policy identity;
- patch/tree digest;
- tests invoked + result digests;
- provider mutation call counts;
- GitHub canonical branch/commit/PR identities;
- reconciliation records;
- independent verifier ID/result/evidence IDs;
- final acceptance outcome;
- execution journal sequence from intent through outcome;
- explicit proof no secret material is in the recorded artifacts.

Adversarial test outputs for ambiguous writes, failed tests, revocation, evidence corruption and cancellation are mandatory.

## Verification ladder

1. `node --test packages/coding-agent/test/*.test.ts`
2. targeted E2E using real P1 public interfaces + fake GitHub transport + real sandbox when available
3. `pnpm typecheck`
4. `pnpm boundaries`
5. `pnpm test:all`
6. `pnpm benchmark` because this tracer crosses state/replay/adversarial effect semantics
7. `pnpm prod:check` before claiming the coding vertical is production-wired

If the real sandbox cannot run in CI/environment, record that limitation and do not claim the sandbox-backed tracer passed; the fake-only path is insufficient for the final P1 operational claim.

## Authority / external effects

This ticket exercises real effect semantics but its default tests use fake providers. Live GitHub smoke testing later requires explicit human authorization, a disposable repository and narrowly scoped credential. A PR/branch/commit produced by a live smoke test is a real external effect and must be reconciled/cleaned through governed actions, not hidden as test cleanup.

## Rollback / replay

Replay reconstructs the coding run from durable journal/evidence and may re-run independent verification over immutable evidence. It may not rerun GitHub writes. A failed/rejected run remains inspectable. Repairing an already-created branch/commit/PR requires a new governed WorkEpisode/action.