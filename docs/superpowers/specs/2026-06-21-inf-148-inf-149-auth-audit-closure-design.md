# INF-148 + INF-149 — Auth Audit & Closure/Reframe Design

Date: 2026-06-21
Repo: `E:/test/Infinit_Track_BE`
Scope: backend only
Mode: continuation-based, audit + closure/reframe only

## 1. Problem framing

This cycle does **not** implement a new auth/session feature. It determines, with evidence, whether two auth follow-up issues still represent real backend work:

- **INF-148** — cleanup / retention lifecycle for `auth_sessions`
- **INF-149** — cutover policy for legacy access tokens without `session_id`

The expected output is a governance-quality verdict grounded in:

1. `develop` repo/runtime truth
2. candidate worktree history as reference evidence
3. shared-context and contract docs
4. Linear issue intent

This design deliberately avoids auth redesign, frontend/client changes, or speculative implementation.

## 2. Why this design exists

The current backend already appears to have the main INF-145 contract alive:

- access token validation depends on persisted `auth_sessions`
- `session_id` is required on the decoded token path
- revoked, expired, and inactive sessions are rejected in middleware

That makes **INF-149 likely a closure/reframe candidate**, not a new implementation candidate.

At the same time, **INF-148 still looks like a plausible backend gap**, but the user explicitly chose to skip implementation in this cycle because a cleanup mechanism feels too complex relative to current value.

Therefore, the goal of this cycle is to answer:

- Is INF-149 already satisfied by current backend reality?
- Is INF-148 a deliberate deferral, a docs gap, or a still-open engineering follow-up?

## 3. Constraints

### Must follow
- `CLAUDE.md` and backend rules in `.claude/rules/*`
- shared context and contract files outside the repo
- backend worktree isolation policy
- evidence-first closure rules

### Must not do
- no cleanup job or retention service implementation
- no auth flow redesign
- no reopening of legacy token acceptance behavior
- no Web FE / Android edits
- no silent contract changes

## 4. Audited sources

### Primary truth target
- `develop` branch in the main repo working tree

### Candidate worktrees to inspect as reference only
- `E:/test/Infinit_Track_BE/.claude/worktrees/refresh-token`
- `E:/test/Infinit_Track_BE/.worktrees/inf-145-auth-session-contract-e2e`
- `E:/test/Infinit_Track_BE/.worktrees/inf-148-auth-session-cleanup`

### Primary code evidence
- `src/middlewares/authJwt.js`
- `src/controllers/auth.controller.js`
- `src/models/authSession.model.js`
- relevant auth/session tests

### Contract / governance evidence
- `API_CONTRACT.md`
- `GLOBAL_STATUS.md`
- `EXECUTION_WORKTREE_POLICY.md`
- `LOOP_CLOSURE_CONTRACT.md`
- Linear issues `INF-148` and `INF-149`

## 5. Audit questions

### INF-149 audit questions
1. Does any current backend runtime path still accept an access token without `session_id`?
2. Is any grace window, compatibility fallback, or implicit legacy handling still active?
3. Do tests confirm the reject behavior?
4. Do shared contract docs and repo docs describe the current behavior clearly enough?

### INF-148 audit questions
1. Is there any implemented cleanup/retention mechanism already present in `develop` or a viable continuation worktree?
2. If not implemented, is the absence only a backlog item, or does it currently create a verified backend risk severe enough to require immediate work?
3. Are docs or issue framing overstating readiness versus actual repo behavior?

## 6. Decision model

### INF-149 verdict options
- **Close as no backend code change required**
- **Reframe to docs/contract clarification required**
- **Keep open only if a real backend acceptance path still exists**

Preferred expectation: close or reframe, not implement.

### INF-148 verdict options
- **Defer / keep backlog with explicit risk acceptance**
- **Reframe as docs/policy clarification only**
- **Keep open as operational backend follow-up** if audit shows the issue is still valid but intentionally not scheduled now

Preferred expectation: defer/reframe, not implement in this cycle.

## 7. Recommended outcome shape

### Recommended INF-149 outcome
If middleware and tests confirm strict rejection of tokens without `session_id`, then:

- no backend code change required
- closure note should state that INF-145 contract is already active in `develop`
- if wording is ambiguous in docs, classify the remaining work as documentation clarification rather than backend feature work

### Recommended INF-148 outcome
If no cleanup mechanism exists, but there is no evidence of current runtime degradation, then:

- do **not** mark implemented
- classify as deferred operational hygiene / retention follow-up
- attach explicit risk note: `auth_sessions` growth remains unmanaged by design for now
- if needed, add docs note that retention cleanup is not active yet

## 8. Deliverables for this cycle

The audit output must include:

1. **Fact** — what is true in code/tests/worktrees/docs
2. **Assumption** — any policy or risk interpretation not directly encoded
3. **Mismatch / Needs Verification** — where issue wording and repo truth differ
4. **Risk** — if skipped, what risk remains
5. **Files inspected / changed** — expected to be mostly inspected; changed only if docs clarification is truly needed
6. **Verification evidence** — fresh evidence from this cycle
7. **Docs / ADR update note** — explicit yes/no and why
8. **PR / closure note** — split clearly between INF-148 and INF-149

## 9. Verification plan

Minimum verification for this audit cycle:

- inspect auth middleware behavior in code
- inspect auth lifecycle controller behavior in code
- inspect relevant auth/session tests
- run fresh verification commands appropriate to auth/session evidence
  - `npm run lint`
  - `npm test`
  - targeted auth/session tests if needed to isolate the contract
- compare candidate worktrees against `develop` to classify them as:
  - reference only
  - viable continuation path
  - stale / non-substantive for current scope

## 10. Worktree policy for this cycle

This cycle starts as read-mostly audit work.

- Candidate worktrees are reviewed first.
- If no write is required, no execution branch needs to be activated.
- If a small docs clarification is later justified, it must be done in an isolated worktree from `develop`, not in the main working tree.

## 11. Success criteria

This cycle is successful if:

- INF-149 gets an evidence-backed closure or reframe verdict
- INF-148 gets an evidence-backed defer/reframe verdict
- no unnecessary auth redesign is introduced
- the final report clearly separates:
  - what is already true in backend reality
  - what remains intentionally unimplemented
  - what still needs verification or documentation clarification

## 12. Out of scope reminder

- cleanup implementation
- retention scheduler/job creation
- auth token contract redesign
- frontend or mobile rollout work
- any change that reintroduces legacy token acceptance
