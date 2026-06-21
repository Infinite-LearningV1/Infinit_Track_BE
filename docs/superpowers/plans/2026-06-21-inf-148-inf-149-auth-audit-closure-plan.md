# INF-148 + INF-149 Auth Audit & Closure/Reframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit `develop` and the referenced auth/session worktrees, then produce an evidence-backed verdict that (a) INF-149 is either already satisfied or still has a real backend gap, and (b) INF-148 is either deferred/reframed or still demands follow-up — without implementing cleanup or redesigning auth.

**Architecture:** This is a read-mostly audit cycle. Treat `develop` as runtime truth, candidate worktrees as historical/reference evidence, and verification output as the closure gate. Only create an isolated execution worktree if the audit proves a small repo-owned docs clarification is required.

**Tech Stack:** Git worktrees, Node.js/Express backend, Jest, ESLint, Linear issue metadata, Markdown audit artifacts

## Global Constraints

- Backend only; do not change Web FE or Android.
- No auth redesign, no cleanup implementation, no scheduler/job creation, no reopening legacy token acceptance.
- Use `develop` as source-of-truth runtime surface; candidate worktrees are reference evidence, not default execution baselines.
- Auth/session is a high-risk area: every conclusion must be backed by fresh evidence from this cycle.
- Required verification commands: `npm run lint`, `npm test`, plus targeted auth/session tests when narrowing evidence.
- If no repo-owned docs mismatch is proven, do not create a write worktree and do not edit files.
- If a repo-owned docs clarification is proven necessary, do it in an isolated worktree from `develop`, not in the main working tree.
- Final output must explicitly include: Fact, Assumption, Mismatch / Needs Verification, Risk, Files inspected / changed, Verification evidence, Docs / ADR update note, and PR / closure note split between INF-148 and INF-149.

---

## File Structure

### Audit artifacts
- Create: `docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md`
  - Purpose: single source for audit notes, evidence snippets, and final verdict draft.

### Primary code evidence (read-only unless a later task proves otherwise)
- Inspect: `src/middlewares/authJwt.js`
  - Purpose: verify whether access tokens without `session_id` are accepted or rejected.
- Inspect: `src/controllers/auth.controller.js`
  - Purpose: verify how session-backed login/refresh/logout lifecycle is implemented and whether cleanup already exists.
- Inspect: `src/models/authSession.model.js`
  - Purpose: confirm current persisted session fields and what state can be distinguished.

### Primary test evidence
- Inspect/Test: `tests/authMiddlewareContract.test.js`
  - Purpose: verify contract tests for rejecting legacy access tokens and session-backed validation.
- Inspect/Test: `tests/authSessionLifecycleContract.test.js`
  - Purpose: verify lifecycle assumptions around auth sessions.
- Inspect/Test: `tests/authRefreshContract.test.js`
- Inspect/Test: `tests/authLoginCookieReuse.test.js`
- Inspect/Test: `tests/authJwtTokenPrecedence.test.js`

### Potential docs clarification targets (modify only if Task 5 is triggered)
- Candidate modify: `docs/openapi.yaml`
- Candidate modify: `README.md`
- Candidate modify: `docs/adr/*` only if an auth contract ambiguity is proven and the repo already keeps that contract here

### Reference-only worktrees
- Inspect only: `E:/test/Infinit_Track_BE/.claude/worktrees/refresh-token`
- Inspect only: `E:/test/Infinit_Track_BE/.worktrees/inf-145-auth-session-contract-e2e`
- Inspect only: `E:/test/Infinit_Track_BE/.worktrees/inf-148-auth-session-cleanup`

---

### Task 1: Build the audit artifact and classify worktree reality

**Files:**
- Create: `docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md`
- Inspect: `E:/test/Infinit_Track_BE/.claude/worktrees/refresh-token`
- Inspect: `E:/test/Infinit_Track_BE/.worktrees/inf-145-auth-session-contract-e2e`
- Inspect: `E:/test/Infinit_Track_BE/.worktrees/inf-148-auth-session-cleanup`

**Interfaces:**
- Consumes: approved spec at `docs/superpowers/specs/2026-06-21-inf-148-inf-149-auth-audit-closure-design.md`
- Produces: `docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md` with sections `Worktree Reality`, `Code Reality`, `Verification Evidence`, `Verdict Draft`

- [ ] **Step 1: Create the audit report skeleton**

```markdown
# INF-148 + INF-149 Auth Audit Report

## Worktree Reality
- develop:
- refresh-token worktree:
- inf-145 auth-session-contract-e2e worktree:
- inf-148 auth-session-cleanup worktree:

## Code Reality
- authJwt.js:
- auth.controller.js:
- authSession.model.js:

## Verification Evidence
- lint:
- full test suite:
- targeted auth/session tests:

## Verdict Draft
### INF-148
- Fact:
- Assumption:
- Mismatch / Needs Verification:
- Risk:
- Recommendation:

### INF-149
- Fact:
- Assumption:
- Mismatch / Needs Verification:
- Risk:
- Recommendation:
```

- [ ] **Step 2: Write the skeleton to disk**

Run: `python - <<'PY'
from pathlib import Path
content = Path('docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md')
content.parent.mkdir(parents=True, exist_ok=True)
content.write_text('''# INF-148 + INF-149 Auth Audit Report

## Worktree Reality
- develop:
- refresh-token worktree:
- inf-145 auth-session-contract-e2e worktree:
- inf-148 auth-session-cleanup worktree:

## Code Reality
- authJwt.js:
- auth.controller.js:
- authSession.model.js:

## Verification Evidence
- lint:
- full test suite:
- targeted auth/session tests:

## Verdict Draft
### INF-148
- Fact:
- Assumption:
- Mismatch / Needs Verification:
- Risk:
- Recommendation:

### INF-149
- Fact:
- Assumption:
- Mismatch / Needs Verification:
- Risk:
- Recommendation:
''', encoding='utf-8')
PY`
Expected: file created with no output

- [ ] **Step 3: Collect worktree truth**

Run:
```bash
git worktree list
git -C "E:/test/Infinit_Track_BE/.claude/worktrees/refresh-token" status --short --branch
git -C "E:/test/Infinit_Track_BE/.claude/worktrees/refresh-token" log --oneline --decorate -5
git -C "E:/test/Infinit_Track_BE/.worktrees/inf-145-auth-session-contract-e2e" status --short --branch
git -C "E:/test/Infinit_Track_BE/.worktrees/inf-145-auth-session-contract-e2e" log --oneline --decorate -5
git -C "E:/test/Infinit_Track_BE/.worktrees/inf-148-auth-session-cleanup" status --short --branch
git -C "E:/test/Infinit_Track_BE/.worktrees/inf-148-auth-session-cleanup" log --oneline --decorate -5
git diff --stat develop..inf-145-refresh-session-contract
git diff --stat develop..67f5047
git diff --stat develop..feature/inf-148-auth-session-cleanup
```
Expected: enough evidence to label each candidate as `reference only`, `stale`, or `viable continuation path`

- [ ] **Step 4: Record worktree classifications in the audit report**

Add markdown like this under `## Worktree Reality`:

```markdown
- develop: current runtime truth on branch `develop`
- refresh-token worktree: historical auth/session implementation branch; classify as `reference only` if diff vs `develop` is broad and non-local
- inf-145 auth-session-contract-e2e worktree: detached historical evidence path; classify as `reference only`
- inf-148 auth-session-cleanup worktree: classify as `stale / non-substantive` if it has no cleanup-specific implementation beyond docs/context commits
```

- [ ] **Step 5: Commit the audit scaffold and worktree classification note**

```bash
git add docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md
git commit -m "docs: add INF-148/149 auth audit scaffold"
```

### Task 2: Verify INF-149 legacy-token rejection in code and tests

**Files:**
- Inspect: `src/middlewares/authJwt.js`
- Inspect: `src/controllers/auth.controller.js`
- Inspect/Test: `tests/authMiddlewareContract.test.js`
- Inspect/Test: `tests/authRefreshContract.test.js`
- Inspect/Test: `tests/authJwtTokenPrecedence.test.js`
- Modify: `docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md`

**Interfaces:**
- Consumes: audit report from Task 1
- Produces: INF-149 evidence lines under `## Code Reality` and `## Verdict Draft`

- [ ] **Step 1: Read the exact middleware gate for `session_id`**

Look for this logic in `src/middlewares/authJwt.js` and quote the exact line range in the report:

```js
async function isSessionActive(decoded) {
  if (!decoded?.session_id || !decoded?.id) {
    return false;
  }
```

Expected: the current code rejects decoded access tokens with no `session_id`

- [ ] **Step 2: Read the contract test that exercises the legacy-token path**

Look for this test in `tests/authMiddlewareContract.test.js` and quote it into the report:

```js
it('rejects a decoded access token when no linked auth session id is present', async () => {
  mockVerify.mockReturnValue({
    id: 5,
    role_name: 'Admin',
    email: 'user@example.com'
  });
```

Expected: an explicit test exists that expects a `401` with `{ message: 'Invalid token' }`

- [ ] **Step 3: Run targeted auth/session tests first**

Run:
```bash
npm test -- --runInBand tests/authMiddlewareContract.test.js tests/authRefreshContract.test.js tests/authJwtTokenPrecedence.test.js
```
Expected: PASS for all targeted tests

- [ ] **Step 4: Record the INF-149 findings in the report**

Append content like this under `### INF-149`:

```markdown
- Fact: `src/middlewares/authJwt.js` rejects decoded access tokens without `session_id` before any session lookup.
- Fact: `tests/authMiddlewareContract.test.js` contains an explicit legacy-token rejection test.
- Fact: no grace-period or fallback path was found in middleware or controller code during this audit.
- Assumption: if client rollout is already complete, the remaining work is documentation/governance only.
- Mismatch / Needs Verification: verify whether any non-repo docs still describe a grace period or compatibility behavior.
- Risk: if old client builds still exist in the field, they will be forced to re-auth rather than silently continue.
- Recommendation: close INF-149 as no backend code change required unless docs ambiguity is proven.
```

- [ ] **Step 5: Commit the INF-149 code-and-test evidence note**

```bash
git add docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md
git commit -m "docs: record INF-149 legacy token audit evidence"
```

### Task 3: Verify INF-148 remains unimplemented and classify its risk posture

**Files:**
- Inspect: `src/controllers/auth.controller.js`
- Inspect: `src/models/authSession.model.js`
- Inspect/Test: `tests/authSessionLifecycleContract.test.js`
- Modify: `docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md`

**Interfaces:**
- Consumes: audit report from Task 2
- Produces: INF-148 evidence lines under `## Code Reality` and `## Verdict Draft`

- [ ] **Step 1: Search the repo for cleanup / retention implementation**

Run:
```bash
rg -n "cleanup|retention|purge|delete from auth_sessions|AuthSession\.destroy|destroy\(" src tests
```
Expected: no dedicated `auth_sessions` cleanup job/service should appear if INF-148 is still unimplemented

- [ ] **Step 2: Confirm what session state is currently modeled**

Capture this structure from `src/models/authSession.model.js` in the report:

```js
refresh_jti,
client_type,
user_agent,
last_activity_at,
expires_at,
revoked_at,
revocation_reason
```

Expected: the model distinguishes active vs revoked vs expired/inactive states, but not a cleanup lifecycle

- [ ] **Step 3: Read the lifecycle tests for evidence that auth runtime depends on active-session checks, not cleanup**

Look for assertions in `tests/authSessionLifecycleContract.test.js` that show:

```js
expect(mockAuthSessionCreate).toHaveBeenCalledWith(
  expect.objectContaining({
    user_id: 5,
    client_type: 'web',
```

and session replacement / session validation behavior tied to runtime correctness rather than cleanup.

Expected: tests cover login/session lifecycle, not retention purge

- [ ] **Step 4: Record the INF-148 findings in the report**

Append content like this under `### INF-148`:

```markdown
- Fact: no explicit cleanup/retention service, job, or purge path for `auth_sessions` was found in `develop`.
- Fact: `auth_sessions` is a runtime source of truth for active-session validation, but historical row cleanup is not implemented.
- Fact: the candidate `feature/inf-148-auth-session-cleanup` worktree does not contain substantive cleanup implementation beyond context/docs drift.
- Assumption: current session volume does not yet justify forcing a retention mechanism in this cycle.
- Mismatch / Needs Verification: operational growth impact is not measured by this audit.
- Risk: unmanaged table growth may increase long-term operational noise and storage/query cost.
- Recommendation: keep INF-148 deferred/reframed as operational hygiene follow-up, not mark it implemented.
```

- [ ] **Step 5: Commit the INF-148 gap classification note**

```bash
git add docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md
git commit -m "docs: classify INF-148 auth session cleanup posture"
```

### Task 4: Run closure-gate verification and record fresh evidence

**Files:**
- Modify: `docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md`
- Test: `tests/authMiddlewareContract.test.js`
- Test: `tests/authSessionLifecycleContract.test.js`
- Test: `tests/authRefreshContract.test.js`
- Test: `tests/authLoginCookieReuse.test.js`
- Test: `tests/authJwtTokenPrecedence.test.js`

**Interfaces:**
- Consumes: report findings from Tasks 2 and 3
- Produces: `Verification Evidence` section with fresh command outputs summarized by outcome

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: exits `0`

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: exits `0`

- [ ] **Step 3: Run the targeted auth/session verification pack**

Run:
```bash
npm test -- --runInBand tests/authMiddlewareContract.test.js tests/authSessionLifecycleContract.test.js tests/authRefreshContract.test.js tests/authLoginCookieReuse.test.js tests/authJwtTokenPrecedence.test.js
```
Expected: PASS for all listed auth/session suites

- [ ] **Step 4: Summarize fresh verification evidence in the report**

Add content like this under `## Verification Evidence`:

```markdown
- lint: `npm run lint` -> PASS
- full test suite: `npm test` -> PASS
- targeted auth/session tests: `npm test -- --runInBand tests/authMiddlewareContract.test.js tests/authSessionLifecycleContract.test.js tests/authRefreshContract.test.js tests/authLoginCookieReuse.test.js tests/authJwtTokenPrecedence.test.js` -> PASS
```

If any command fails, replace `PASS` with the actual failure and move the issue to `Needs Verification` instead of forcing closure.

- [ ] **Step 5: Commit the verification evidence update**

```bash
git add docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md
git commit -m "docs: add INF-148/149 auth audit verification evidence"
```

### Task 5: Apply a minimal docs clarification only if the audit proves repo-owned ambiguity

**Files:**
- Create (only if needed): isolated execution worktree from `develop`
- Candidate Modify (only if needed): `docs/openapi.yaml`
- Candidate Modify (only if needed): `README.md`
- Candidate Modify (only if needed): repo-owned auth ADR file if one already exists and is the correct contract surface
- Modify: `docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md`

**Interfaces:**
- Consumes: mismatch findings from Tasks 2–4
- Produces: either `No repo-owned docs change required` in the report, or one minimal docs clarification commit in an isolated worktree

- [ ] **Step 1: Decide whether a repo-owned docs mismatch is actually proven**

Use this gate:

```text
Only continue with a docs edit if a repo-owned document states or implies either:
1. legacy access tokens without `session_id` are still accepted, or
2. `auth_sessions` cleanup/retention is already implemented.
```

Expected: one of two outcomes — `no proven mismatch` or `proven repo-owned ambiguity`

- [ ] **Step 2: If no mismatch is proven, record a no-change decision**

Add this to the report and stop the task there:

```markdown
## Docs / ADR Update Note
- No repo-owned docs change required in this cycle.
- Reason: the audit found either no contradiction or only a governance/Linear wording gap, not a repo-owned contract defect.
```

Expected: no code or docs files changed beyond the report

- [ ] **Step 3: If a mismatch is proven, create an isolated worktree before editing**

Run:
```text
Use EnterWorktree (or the git-worktree execution skill path) to create a fresh worktree from `develop` dedicated to the docs clarification.
```
Expected: edits happen outside the main working tree

- [ ] **Step 4: Apply the smallest possible clarification**

Use a diff no larger than this pattern:

```diff
- Legacy access tokens may continue during migration.
+ Access tokens must include `session_id`. Tokens without `session_id` are rejected by backend middleware and require re-authentication.
```

or

```diff
- Auth session cleanup is handled automatically.
+ Auth session cleanup / retention is not implemented in the backend at this time; any future retention policy remains a deferred operational follow-up.
```

Expected: one precise wording fix, no behavior change

- [ ] **Step 5: Commit the clarification or the no-change decision**

If no change path:
```bash
git add docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md
git commit -m "docs: record no-change auth audit docs verdict"
```

If docs clarification path:
```bash
git add <modified-doc-files> docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md
git commit -m "docs: clarify auth session contract audit verdict"
```

### Task 6: Produce the closure-ready summary for INF-148 and INF-149

**Files:**
- Modify: `docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md`

**Interfaces:**
- Consumes: final evidence and docs decision from Tasks 1–5
- Produces: final closure-ready note with user-facing sections `Fact`, `Assumption`, `Mismatch / Needs Verification`, `Risk`, `Files inspected / changed`, `Verification evidence`, `Docs / ADR update note`, `PR / closure note`

- [ ] **Step 1: Add the exact final-output headings required by the repo rules**

Append this structure to the bottom of the report:

```markdown
## Final Output
### Fact
### Assumption
### Mismatch / Needs Verification
### Risk
### Files inspected / changed
### Verification evidence
### Docs / ADR update note
### PR / closure note
```

- [ ] **Step 2: Fill the final output with explicit INF-148 and INF-149 verdict separation**

Use wording shaped like this:

```markdown
### PR / closure note
- INF-148: no backend cleanup implementation was performed in this cycle. Verdict: defer / reframe as operational hygiene follow-up with explicit growth-risk note.
- INF-149: backend audit confirms legacy access tokens without `session_id` are rejected in current middleware/tested contract. Verdict: no backend code change required; close or reframe as docs/governance clarification only if needed.
```

Expected: a reviewer can copy this directly into a Linear update or PR summary

- [ ] **Step 3: Perform a self-check against the approved spec**

Verify explicitly in the report that:

```markdown
- No auth redesign was introduced.
- No cleanup implementation was introduced.
- Candidate worktrees were used as reference evidence only.
- `develop` remained the runtime truth source.
```

Expected: no uncovered spec requirement remains

- [ ] **Step 4: Commit the closure-ready summary**

```bash
git add docs/superpowers/reports/2026-06-21-inf-148-inf-149-auth-audit-report.md
git commit -m "docs: finalize INF-148/149 auth audit closure summary"
```

- [ ] **Step 5: Present the final verdict without over-claiming completion**

Use this response shape in the final handoff:

```markdown
Fact
- ...

Assumption
- ...

Mismatch / Needs Verification
- ...

Risk
- ...

Files inspected / changed
- ...

Verification evidence
- ...

Docs / ADR update note
- ...

PR / closure note
- INF-148 ...
- INF-149 ...
```

Expected: if any verification failed or any doc contradiction remains unresolved, the final status says `Needs Verification` instead of claiming closure.
