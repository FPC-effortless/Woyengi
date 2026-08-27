# P1-EXE-002 — Governed GitHub Provider Adapter

Status: **BLOCKED ON P0 ACCEPTANCE AND P1-EXE-001**  
Issue lane: #15  
Depends on: P1-EXE-001; accepted P0 contracts  
Unblocks: P1-EXE-006

## Outcome contract

Implement a dedicated GitHub provider adapter that supports the coding tracer bullet's repository/issue/branch/commit/PR/test/build operations while preserving Woyengi's governed external-effect semantics.

The adapter must separate observational reads from consequential mutations, consume opaque credential leases, produce content-bound observations, and reconcile every write through a canonical reread. An ambiguous write must never be automatically repeated.

## Future exclusive file ownership

The implementation agent owns **only**:

- `packages/github-connector/**` (new package directory).

All existing packages/services, shared ADRs, #14/#16 files, `prd.json`, and `progress.txt` are read-only for this ticket. If P1-EXE-001's public execution driver contract is insufficient, report the minimum interface change to #15 rather than editing `packages/execution/**` in this ticket.

## Preconditions / blockers

1. P0 accepted.
2. P1-EXE-001 merged and its public `ExternalEffectDriver`/execution contracts stable enough to consume.
3. A credential-lease interface exists. Unit tests use a fake lease resolver; no real token is committed or required.

## Required operation surface

### Read-only/observational

- `github.repo.get`
- `github.repo.snapshot`
- `github.issue.get`
- `github.issue.list`
- `github.branch.get`
- `github.commit.get`
- `github.pr.get`
- `github.pr.list`
- `github.test.get` (GitHub check/test observation)
- `github.build.get` (workflow/build observation)

### Consequential mutations

- `github.issue.comment` and narrowly scoped issue update required by an authorized WorkEpisode;
- `github.branch.create-or-update` with expected prior ref/SHA;
- `github.commit.publish` from an immutable content/tree digest and expected parent/head;
- `github.pr.create` and narrowly scoped PR update;
- explicit workflow dispatch only when the effect plan authorizes it.

Out of scope: repository deletion, secret administration, org administration, branch-protection changes, destructive history rewrite and force-push.

## Public interfaces

Expose typed provider-facing contracts from the package public index. The exact type names may vary, but the API must preserve these distinctions:

```ts
export type GitHubReadOperation =
  | GitHubRepoGet
  | GitHubRepoSnapshot
  | GitHubIssueGet
  | GitHubIssueList
  | GitHubBranchGet
  | GitHubCommitGet
  | GitHubPullRequestGet
  | GitHubPullRequestList
  | GitHubTestGet
  | GitHubBuildGet;

export type GitHubMutationOperation =
  | GitHubIssueComment
  | GitHubIssueUpdate
  | GitHubBranchCreateOrUpdate
  | GitHubCommitPublish
  | GitHubPullRequestCreate
  | GitHubPullRequestUpdate
  | GitHubWorkflowDispatch;

export interface GitHubTransport {
  read(input: GitHubReadOperation, auth: OpaqueProviderAuth): Promise<GitHubReadObservation>;
  mutate(input: GitHubMutationOperation, auth: OpaqueProviderAuth): Promise<GitHubDispatchObservation>;
}
```

Provider authentication is opaque to callers. The GitHub package may materialize the lease inside its transport boundary but must not expose credential text in return values, errors, logs or evidence.

## Stable request fingerprint

Every mutation must produce a canonical stable fingerprint over provider-neutral normalized fields plus GitHub target identity. At minimum include:

- workspace-scoped binding ID indirectly through the execution claim, not secret material;
- owner/repository immutable locator;
- operation kind;
- target issue/ref/PR/workflow identity;
- preconditions such as expected old branch SHA;
- normalized user-visible body/title/message digests;
- content/tree/patch digest for commit publication;
- base/head for PR creation;
- workflow input digest for dispatch;
- Woyengi expected-effect ID/correlation marker where applicable.

Changing any consequential field while reusing an idempotency key must produce a fingerprint conflict in the coordinator.

## Canonical reconciliation rules

### Issue comment/update

- embed an opaque effect marker in a semantically harmless provider field when possible;
- reread the issue/comment collection;
- confirm marker + normalized content digest + target issue;
- duplicate matching comments are `DIVERGED`, not silently accepted as one effect.

### Branch create/update

- require expected prior SHA when modifying an existing ref;
- reread exact ref;
- `CONFIRMED` only when ref equals requested target SHA;
- a different new SHA is `DIVERGED`.

### Commit publish

- bind request to parent SHA + tree/content digest + commit message digest;
- reread immutable commit identity and target ref;
- confirm exact parent/tree/ref relationship.

### PR create/update

- include an opaque Woyengi effect marker in body metadata where allowed;
- reread/list by head/base and marker;
- confirm title/body digest, head SHA and base;
- multiple matching PRs or mismatched head is `DIVERGED`/`UNCERTAIN`, never auto-selected as success.

### Workflow dispatch

- dispatch is an `EXTERNAL` effect;
- observe resulting run using the strongest available provider correlation;
- if the provider cannot establish a unique run identity, reconciliation remains `UNCERTAIN` rather than assuming success from HTTP 204.

## Repository snapshot contract

`github.repo.snapshot` returns an immutable, content-bound input for the sandbox. It must identify at minimum:

- repository locator;
- requested ref;
- resolved commit SHA;
- retrieval time;
- snapshot/archive/tree digest or equivalent immutable content identity;
- submodule/LFS handling status when relevant;
- no GitHub credential material.

The initial sandbox path should receive repository bytes/snapshot from the orchestrator, not a broad GitHub token.

## Error taxonomy

Expose typed/safe categories sufficient for coordinator policy:

- `AUTHENTICATION_FAILED`;
- `AUTHORIZATION_FAILED`;
- `NOT_FOUND`;
- `PRECONDITION_FAILED`;
- `RATE_LIMITED`;
- `PROVIDER_REJECTED`;
- `TRANSIENT_READ_FAILURE`;
- `AMBIGUOUS_WRITE`;
- `MALFORMED_PROVIDER_RESPONSE`.

Only an error that proves the provider did **not** accept the mutation may be treated as a non-ambiguous rejection. Connection reset/timeout after dispatch begins is `AMBIGUOUS_WRITE`.

## Non-goals

- bypassing P1-EXE-001 idempotency claims;
- acceptance/semantic commit decisions;
- generic connector ingestion changes in `packages/connector-sdk`;
- putting GitHub tokens into sandbox env, Work state or evidence;
- a general GitHub administration SDK;
- automatic retries for create/update mutations.

## Falsifiers / tests first

Write failing adapter tests for:

1. read operation never creates an `EXTERNAL` mutation call;
2. same confirmed branch mutation reconciles by exact SHA;
3. branch precondition mismatch fails before unsafe update;
4. HTTP success + wrong reread SHA -> `DIVERGED`;
5. PR create returns success but reread cannot find unique marker/head/base -> `UNCERTAIN`;
6. PR create times out after fake provider created PR -> canonical reread finds it; mutation call count remains one;
7. repeated recovery after timeout -> zero additional mutation calls;
8. issue comment timeout + exact marked comment exists -> `CONFIRMED` without duplicate comment;
9. duplicate marked comments -> not silently `CONFIRMED`;
10. commit reread tree/parent mismatch -> `DIVERGED`;
11. workflow dispatch HTTP success without unique run evidence -> `UNCERTAIN`;
12. credential-shaped secret is absent from all returned observations/errors/evidence fixtures;
13. cross-repository/target mismatch in reread -> `DIVERGED`;
14. malformed provider JSON/headers fail closed;
15. rate-limit response is observational/provider failure and does not manufacture accepted effect state.

## Evidence required from implementation

- fake GitHub transport transcripts with secrets redacted/absent;
- request fingerprints for at least branch, commit and PR operations;
- provider mutation call counts for ambiguous-write recovery cases;
- canonical reread evidence objects bound to immutable GitHub identities;
- operation coverage table showing read vs external mutation classification.

## Verification ladder

1. `node --test packages/github-connector/test/*.test.ts`
2. `pnpm typecheck`
3. `pnpm boundaries`
4. `pnpm test:all`
5. `pnpm benchmark` if GitHub adversarial/replay cases are added to the benchmark harness
6. `pnpm prod:check` only when a live provider transport is wired into production paths

Live-provider smoke testing, if later authorized, must use a disposable repository and explicitly scoped credential. It is not required for the first unit implementation and must never use production credentials by default.

## Authority / external effects

Every mutation is an `EXTERNAL` effect and must enter through the coordinator after current authority validation and durable claim. The adapter itself has no authority to decide whether an operation is allowed. Read operations remain workspace/binding scoped even when they are non-mutating.

## Rollback / recovery

Adapter rollback does not undo GitHub state. Recovery uses canonical reads. Closing/reverting/resetting/amending provider state is a new separately authorized compensating action, not an adapter cleanup function.