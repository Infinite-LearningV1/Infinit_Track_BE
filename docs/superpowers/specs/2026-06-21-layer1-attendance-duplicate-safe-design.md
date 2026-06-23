# Layer 1 Closure Design — Attendance Duplicate-Safe Consistency

- **Date:** 2026-06-21
- **Repo:** `Infinit_Track_BE`
- **Family:** Family B — Attendance Capture Core
- **Layer:** Layer 1 — Backend Truth Boundary
- **Issue chain:** INF-16, INF-17, INF-20
- **Execution model:** isolated worktree from current `origin/develop`

## 1. Goal

Close Layer 1 honestly and evidence-first by tightening the duplicate-safe contract around backend attendance truth without changing core business behavior.

This pass focuses on the consistency between:

1. request-driven attendance capture (`checkIn`),
2. job-driven attendance mutation (`createGeneralAlpha`, `resolveWfaBookings`), and
3. the database truth guard (`uq_attendance_user_date`).

The intended outcome is not a redesign. The intended outcome is:

- explicit truth-boundary documentation,
- small behavior-preserving hardening,
- fresh verification evidence,
- and a closure note that positions INF-16 / INF-17 / INF-20 accurately.

## 2. Repo Reality Summary

### 2.1 Final attendance truth boundary

The backend currently treats one `attendance` row per `(user_id, attendance_date)` as the final daily truth boundary.

Evidence:

- model-level unique index on `Attendance`: `src/models/attendance.model.js`
- migration that removes historical duplicates and adds `uq_attendance_user_date`: `src/models/migrations/20260403000000-add-unique-constraint-attendance.cjs`

This means all attendance writers, whether request-driven or job-driven, are ultimately constrained by the same database uniqueness rule.

### 2.2 Capture-core entry flow

The capture-core write path is:

- `POST /api/attendance/check-in` → `checkIn`
- `POST /api/attendance/checkout/:id` → `checkOut`
- `GET /api/attendance/status-today` → primary read surface for current-day client state

The operational/test trigger surfaces also exist under the attendance controller for date-targeted job execution:

- `manualGeneralAlphaForDate`
- `manualResolveWfaForDate`
- `manualSmartAutoCheckoutForDate`

These manual endpoints are not the core capture flow, but they do invoke truth-changing backend jobs and therefore are part of the Layer 1 truth boundary.

### 2.3 Job-driven truth mutation

The current backend can create or finalize attendance truth outside request capture through:

- `runGeneralAlphaForDate` / scheduled general alpha job
- `resolveWfaBookingsForDate` / scheduled WFA resolver
- `runSmartAutoCheckoutForDate`

The first two are directly relevant to duplicate-safe consistency because they can attempt to create attendance rows for dates that may already have been written.

## 3. Problem Statement

The current develop branch already contains meaningful duplicate-safe hardening, but the contract is still partially implicit.

### 3.1 What is already good

#### Request path

`checkIn` already has two layers of protection:

1. pre-insert duplicate check for the same `user_id + attendance_date`, and
2. DB-race handling through `isAttendanceDuplicateConstraintError(...)` when `Attendance.create(...)` hits the unique constraint after passing pre-check.

Expected behavior:

- duplicate request path is a **client-visible conflict** (`409`).

#### Job path

`createGeneralAlpha` and `resolveWfaBookings` already use:

- pre-insert filtering of existing attendance rows, and
- transactional `bulkCreate(..., { ignoreDuplicates: true })`.

Expected behavior:

- duplicate insert attempts during rerun/race are **idempotent skips/no-ops**, not business failures.

#### DB path

The database uniqueness constraint is the final truth guard.

### 3.2 What is still weak

Even though the implementation is materially stronger now, the duplicate-safe story is still spread across different files with slightly different language and assumptions.

The remaining Layer 1 weakness is not “missing unique guard.”
The weakness is “the contract is not yet explicit enough across layers.”

Examples:

- request path and job path interpret duplicate outcomes differently, but the distinction is not framed as a single intentional contract seam,
- the model/migration guarantee exists, but that guarantee is not clearly elevated as backend truth language,
- tests prove pieces of the behavior, but the cross-layer closure story still needs to be written and tightened.

## 4. Scope

This pass includes:

1. writing an explicit Layer 1 design/spec for duplicate-safe consistency,
2. creating a fresh execution branch/worktree from current `origin/develop`,
3. applying only small behavior-preserving hardening in backend duplicate-safe seams,
4. running fresh verification (`npm run lint`, `npm test`),
5. producing a closure note that maps the result back to INF-16 / INF-17 / INF-20.

## 5. Non-Goals

This pass does **not**:

- redesign attendance architecture,
- change scheduler timing,
- change final-state business semantics,
- redesign `checkOut` or smart auto-checkout,
- migrate all magic-number domain assumptions into a full enum layer,
- modify Android or Web FE,
- or reuse stale candidate branches as the execution base.

## 6. Candidate Path Decision

The existing candidate paths are treated as **reference-only**, not write surfaces:

- `.claude/worktrees/inf23-task1-idempotency-tests`
- `inf-17-duplicate-safe`
- `.worktrees/attendance-jobs-audit`

Reason:

- they are stale relative to current `origin/develop`,
- at least one is behind remote / based on older lineage,
- and current `origin/develop` already contains a more mature Layer 1 duplicate-safe baseline.

Therefore, the execution surface for this pass is a **new worktree/branch from current `origin/develop`**.

## 7. Recommended Hardening Strategy

### Approach chosen

**Consistency hardening at the domain seam**.

This is preferred over “tests only” and over “mini-refactor” because it keeps the change behavior-preserving while still producing a meaningful Layer 1 closure.

### 7.1 Request-path contract

Clarify and keep intact:

- one attendance row per `user_id + attendance_date`,
- duplicate before insert → `409 conflict`,
- duplicate at DB-race after passing pre-check → the same `409 conflict` contract.

Hardening in this area should not change success-path behavior. It should make duplicate intent easier to understand and verify.

### 7.2 Job-path contract

Clarify and keep intact:

- alpha/WFA resolver jobs may race or rerun,
- duplicate attendance writes are not a business failure when they arise from idempotent rerun/race,
- the correct interpretation is skip/no-op with `ignoreDuplicates` as the final insert guard.

Hardening here should improve consistency of semantics, not change which rows are considered candidates.

### 7.3 DB-path contract

Elevate the uniqueness constraint from “implementation detail” to “truth-boundary guard.”

This does not require changing the existing unique index behavior. It requires making the code/spec/tests treat it as the final backend truth enforcement point.

## 8. File Plan

### Primary change candidates

#### Request seam

- `src/controllers/attendance.controller.js`
- `src/utils/attendanceDuplicateError.js`

Potential hardening:

- small helper/constant alignment,
- more explicit duplicate-safe naming/usage,
- consistency between pre-check and race-handling paths.

#### Job seam

- `src/jobs/createGeneralAlpha.job.js`
- `src/jobs/resolveWfaBookings.job.js`

Potential hardening:

- clarify no-op/skip semantics,
- align duplicate-safe wording,
- keep `ignoreDuplicates` handling explicit and testable.

#### Evidence / tests

- `tests/attendanceDuplicateSafety.test.js`
- `tests/createGeneralAlphaJobIdempotency.test.js`
- `tests/resolveWfaBookingsJobIdempotency.test.js`

Potential hardening:

- strengthen cross-layer expectation language,
- add or reshape tests only where needed to make the seam explicit.

### Reference-only files

- `src/models/attendance.model.js`
- `src/models/migrations/20260403000000-add-unique-constraint-attendance.cjs`

These are expected to remain semantically unchanged in this pass unless the audit reveals a tiny documentation-level inconsistency.

## 9. Verification Plan

### Fresh minimum verification

- `npm run lint`
- `npm test`

### Focus verification

At minimum, the following must remain green:

- `tests/attendanceDuplicateSafety.test.js`
- `tests/createGeneralAlphaJobIdempotency.test.js`
- `tests/resolveWfaBookingsJobIdempotency.test.js`

These tests are the closest proof surface for the Layer 1 duplicate-safe seam.

## 10. Closure Criteria

### INF-16 — Final-state boundary audit

This pass closes the audit honestly if the written spec and resulting branch clearly state:

- which request paths write attendance truth,
- which jobs can create/finalize attendance truth,
- and which DB guard is the final enforcement point.

### INF-17 — Duplicate-safe consistency

This pass closes duplicate-safe consistency if the resulting branch makes the following interpretation explicit and verifiable:

- request duplicate → conflict,
- job duplicate/rerun → skip/no-op,
- DB unique index → final guard,
- fresh verification evidence exists.

### INF-20 — Hidden domain assumptions

This pass does not fully close all hidden assumptions.

What it can close is the subset directly relevant to duplicate-safe consistency by documenting them explicitly in the spec/closure note, including:

- the single-row-per-day truth rule,
- the difference between request conflict and job idempotent skip,
- and where the DB contract becomes authoritative.

## 11. Risks

### Main risk

A “small” change in attendance truth handling can accidentally change business behavior if it crosses from semantics clarification into runtime redesign.

### Mitigation

- stay on current `origin/develop`,
- keep hardening local to duplicate-safe seams,
- require fresh lint + full test evidence,
- and mark unresolved ambiguity as **Needs Verification** instead of overclaiming closure.

## 12. Expected Output

At the end of this pass, the repo should contain:

1. this Layer 1 design spec,
2. a small hardening diff from a fresh execution worktree,
3. fresh verification evidence,
4. and a PR/closure note that positions the work as:

> boundary clarification + duplicate-safe consistency closure,
> not a redesign of the attendance system.

## 13. Closure Addendum Template

When implementation is complete, record:

- request-path duplicate outcome stayed `409 conflict`
- job-path duplicate outcome stayed idempotent skip/no-op
- DB unique boundary stayed `attendance(user_id, attendance_date)`
- fresh verification commands executed successfully
- remaining hidden domain assumptions still deferred beyond duplicate-safe consistency

Closure note:
- INF-16: final-state boundary remains request-visible and unchanged
- INF-17: duplicate-safe consistency stays aligned across request/job paths
- INF-20: hidden assumptions are still deferred and remain Needs Verification
