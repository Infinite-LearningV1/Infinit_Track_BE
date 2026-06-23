# Layer 1 Duplicate-Safe Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make duplicate-safe semantics explicit and consistent across request-path attendance capture, job-path attendance creation, and the DB uniqueness guard without changing attendance business behavior.

**Architecture:** Add one small shared duplicate-safe contract utility, then make `checkIn`, `createGeneralAlpha`, and `resolveWfaBookings` consume it so all three layers speak the same truth-boundary language. Keep the `attendance` table unique key (`user_id + attendance_date`) as the final guard; hardening only clarifies how each caller interprets duplicate outcomes.

**Tech Stack:** Node.js ESM, Express, Sequelize, MySQL, Jest

## Global Constraints

- Backend only; do not touch Android or Web FE.
- Work from a fresh isolated branch/worktree based on current `origin/develop`.
- Keep this pass behavior-preserving: no scheduler timing changes, no attendance final-state semantic changes, no API contract redesign.
- Request-path duplicate for `checkIn` must stay a client-visible `409 conflict`.
- Job-path duplicate during rerun/race must stay an idempotent skip/no-op, not a business failure.
- The DB truth boundary remains `attendance(user_id, attendance_date)` via `uq_attendance_user_date`.
- Verification is mandatory: `npm run lint` and `npm test`.
- Focus proof tests: `tests/attendanceDuplicateSafety.test.js`, `tests/createGeneralAlphaJobIdempotency.test.js`, `tests/resolveWfaBookingsJobIdempotency.test.js`.

---

### Task 1: Add a shared duplicate-safe contract utility

**Files:**
- Create: `src/utils/attendanceDuplicateContract.js`
- Modify: `src/utils/attendanceDuplicateError.js`
- Test: `tests/attendanceDuplicateSafety.test.js`

**Interfaces:**
- Consumes: existing Sequelize duplicate error shape from `SequelizeUniqueConstraintError`
- Produces:
  - `ATTENDANCE_DAILY_TRUTH_FIELDS: readonly string[]`
  - `ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE: string`
  - `matchesAttendanceDailyTruthFields(fieldNames: string[]): boolean`
  - `buildDuplicateSafeJobSummary(input: { label: string, requested: number, skipped: number, created?: number | null }): string`
  - `isAttendanceDuplicateConstraintError(error: unknown): boolean`
  - `createAttendanceConflictError(message?: string): Error & { status: number }`

- [ ] **Step 1: Write the failing contract test cases**

Add these tests near the top of `tests/attendanceDuplicateSafety.test.js`:

```js
it('matches the daily attendance truth fields regardless of order', async () => {
  const { matchesAttendanceDailyTruthFields } = await import(
    '../src/utils/attendanceDuplicateContract.js'
  );

  expect(matchesAttendanceDailyTruthFields(['attendance_date', 'user_id'])).toBe(true);
  expect(matchesAttendanceDailyTruthFields(['user_id'])).toBe(false);
  expect(matchesAttendanceDailyTruthFields(['booking_id', 'attendance_date'])).toBe(false);
});

it('builds a deterministic duplicate-safe job summary for known created count', async () => {
  const { buildDuplicateSafeJobSummary } = await import(
    '../src/utils/attendanceDuplicateContract.js'
  );

  expect(
    buildDuplicateSafeJobSummary({
      label: 'general alpha',
      requested: 2,
      skipped: 3,
      created: 2
    })
  ).toBe('Duplicate-safe general alpha insert completed. Requested: 2, created: 2, skipped: 3.');
});

it('builds a deterministic duplicate-safe job summary when created count is unavailable', async () => {
  const { buildDuplicateSafeJobSummary } = await import(
    '../src/utils/attendanceDuplicateContract.js'
  );

  expect(
    buildDuplicateSafeJobSummary({
      label: 'unused WFA alpha',
      requested: 1,
      skipped: 0,
      created: null
    })
  ).toBe(
    'Duplicate-safe unused WFA alpha insert completed. Requested: 1, skipped: 0, created count unavailable because ignoreDuplicates was used.'
  );
});
```

- [ ] **Step 2: Run the targeted test to verify the new contract module is missing**

Run:

```bash
npm test -- --runTestsByPath tests/attendanceDuplicateSafety.test.js --runInBand
```

Expected: FAIL with module or export errors for `attendanceDuplicateContract.js` / missing functions.

- [ ] **Step 3: Write the minimal shared contract utility and wire `attendanceDuplicateError.js` to it**

Create `src/utils/attendanceDuplicateContract.js` with:

```js
export const ATTENDANCE_DAILY_TRUTH_FIELDS = Object.freeze(['user_id', 'attendance_date']);

export const ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE = 'Anda sudah melakukan check-in hari ini.';

export const matchesAttendanceDailyTruthFields = (fieldNames = []) => {
  const availableFields = new Set(fieldNames.filter(Boolean));
  return ATTENDANCE_DAILY_TRUTH_FIELDS.every((field) => availableFields.has(field));
};

export const buildDuplicateSafeJobSummary = ({ label, requested, skipped, created = null }) => {
  if (typeof created === 'number') {
    return `Duplicate-safe ${label} insert completed. Requested: ${requested}, created: ${created}, skipped: ${skipped}.`;
  }

  return `Duplicate-safe ${label} insert completed. Requested: ${requested}, skipped: ${skipped}, created count unavailable because ignoreDuplicates was used.`;
};
```

Modify `src/utils/attendanceDuplicateError.js` to:

```js
import {
  ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE,
  matchesAttendanceDailyTruthFields
} from './attendanceDuplicateContract.js';

export const isAttendanceDuplicateConstraintError = (error) => {
  if (!error || error.name !== 'SequelizeUniqueConstraintError') {
    return false;
  }

  const fields = Object.keys(error.fields || {});
  const errorPaths = (error.errors || []).map((item) => item.path);
  return matchesAttendanceDailyTruthFields([...fields, ...errorPaths]);
};

export const createAttendanceConflictError = (
  message = ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE
) => {
  const error = new Error(message);
  error.status = 409;
  return error;
};
```

- [ ] **Step 4: Re-run the targeted test to verify the contract module works**

Run:

```bash
npm test -- --runTestsByPath tests/attendanceDuplicateSafety.test.js --runInBand
```

Expected: PASS for the new helper tests and existing duplicate-helper tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/attendanceDuplicateContract.js src/utils/attendanceDuplicateError.js tests/attendanceDuplicateSafety.test.js
git commit -m "refactor: add duplicate-safe attendance contract utility"
```

### Task 2: Make `checkIn` consume the shared duplicate-safe request contract

**Files:**
- Modify: `src/controllers/attendance.controller.js`
- Test: `tests/attendanceDuplicateSafety.test.js`

**Interfaces:**
- Consumes:
  - `ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE: string`
  - `isAttendanceDuplicateConstraintError(error): boolean`
- Produces:
  - request-path duplicate responses that use one shared conflict message for both pre-check and DB-race duplicate paths

- [ ] **Step 1: Write the failing request-path consistency test**

Add this test inside the `describe('checkIn duplicate-safe behavior', ...)` block in `tests/attendanceDuplicateSafety.test.js`:

```js
it('uses the same duplicate-safe conflict message for pre-check and DB-race duplicates', async () => {
  const { ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE } = await import(
    '../src/utils/attendanceDuplicateContract.js'
  );

  expect(ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE).toBe('Anda sudah melakukan check-in hari ini.');
});
```

Then strengthen the two existing duplicate-response assertions by changing them to:

```js
expect(res.json).toHaveBeenCalledWith(
  expect.objectContaining({
    success: false,
    message: 'Anda sudah melakukan check-in hari ini.'
  })
);
```

Use that same assertion in both:

- `returns 409 when check-in pre-check finds existing attendance`
- `returns 409 when create hits unique constraint after passing pre-check`

- [ ] **Step 2: Run the targeted request-path test file before implementation**

Run:

```bash
npm test -- --runTestsByPath tests/attendanceDuplicateSafety.test.js --runInBand
```

Expected: FAIL if `attendance.controller.js` still uses inline duplicate strings or if one duplicate path drifts from the shared contract.

- [ ] **Step 3: Replace inline duplicate messages in `checkIn` with the shared contract message**

Update the imports near the top of `src/controllers/attendance.controller.js` to include the shared message:

```js
import {
  ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE
} from '../utils/attendanceDuplicateContract.js';
import { isAttendanceDuplicateConstraintError } from '../utils/attendanceDuplicateError.js';
```

Change the pre-check duplicate response inside `checkIn` to:

```js
if (existingAttendance) {
  await rollbackTransaction();
  return res.status(409).json({
    success: false,
    message: ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE
  });
}
```

Change the DB-race duplicate response inside the `Attendance.create(...)` catch block to:

```js
if (isAttendanceDuplicateConstraintError(error)) {
  await rollbackTransaction();
  return res.status(409).json({
    success: false,
    message: ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE
  });
}
```

- [ ] **Step 4: Re-run the targeted request-path test file**

Run:

```bash
npm test -- --runTestsByPath tests/attendanceDuplicateSafety.test.js --runInBand
```

Expected: PASS with both duplicate request paths returning the same contract message.

- [ ] **Step 5: Commit**

```bash
git add src/controllers/attendance.controller.js tests/attendanceDuplicateSafety.test.js
git commit -m "refactor: align check-in duplicate conflict semantics"
```

### Task 3: Make job-path duplicate-safe summaries explicit and shared

**Files:**
- Modify: `src/jobs/createGeneralAlpha.job.js`
- Modify: `src/jobs/resolveWfaBookings.job.js`
- Test: `tests/attendanceDuplicateSafety.test.js`
- Test: `tests/createGeneralAlphaJobIdempotency.test.js`
- Test: `tests/resolveWfaBookingsJobIdempotency.test.js`

**Interfaces:**
- Consumes:
  - `buildDuplicateSafeJobSummary(input): string`
- Produces:
  - deterministic duplicate-safe job log summaries for known-created and ignoreDuplicates-created-unavailable cases

- [ ] **Step 1: Write the failing job-summary expectations**

In `tests/createGeneralAlphaJobIdempotency.test.js`, add this assertion to the first test after the result check:

```js
expect(mockAttendanceBulkCreate).toHaveBeenCalledTimes(1);
```

Then add a logger assertion in that same test:

```js
const logger = (await import('../src/utils/logger.js')).default;
expect(logger.info).toHaveBeenCalledWith(
  'Duplicate-safe general alpha insert completed. Requested: 1, created: 1, skipped: 2.'
);
```

In `tests/resolveWfaBookingsJobIdempotency.test.js`, replace the current exact logger string assertion with:

```js
expect(mockLogger.info).toHaveBeenCalledWith(
  'Duplicate-safe unused WFA alpha insert completed. Requested: 1, skipped: 0, created count unavailable because ignoreDuplicates was used.'
);
```

In `tests/attendanceDuplicateSafety.test.js`, replace the existing resolver logger expectation with the same new string:

```js
expect(mockLogger.info).toHaveBeenCalledWith(
  'Duplicate-safe unused WFA alpha insert completed. Requested: 1, skipped: 0, created count unavailable because ignoreDuplicates was used.'
);
```

- [ ] **Step 2: Run the three duplicate-safe test files before changing the jobs**

Run:

```bash
npm test -- --runTestsByPath tests/attendanceDuplicateSafety.test.js tests/createGeneralAlphaJobIdempotency.test.js tests/resolveWfaBookingsJobIdempotency.test.js --runInBand
```

Expected: FAIL because the current logger output still uses older per-job wording.

- [ ] **Step 3: Replace ad-hoc job summary logs with the shared contract helper**

In `src/jobs/createGeneralAlpha.job.js`, add the import:

```js
import { buildDuplicateSafeJobSummary } from '../utils/attendanceDuplicateContract.js';
```

Replace the final summary log in `createGeneralAlphaRecords` with:

```js
logger.info(
  buildDuplicateSafeJobSummary({
    label: 'general alpha',
    requested: insertRowsRequested,
    created,
    skipped: skipped + wfaSkipped
  })
);
```

Replace the final summary log in `runGeneralAlphaForDate` with:

```js
logger.info(
  buildDuplicateSafeJobSummary({
    label: 'general alpha',
    requested: result.insertRowsRequested,
    created: result.created,
    skipped
  })
);
```

In `src/jobs/resolveWfaBookings.job.js`, add the import:

```js
import { buildDuplicateSafeJobSummary } from '../utils/attendanceDuplicateContract.js';
```

Replace the Task A summary log in `handleUnusedApprovedBookings` with:

```js
logger.info(
  buildDuplicateSafeJobSummary({
    label: 'unused WFA alpha',
    requested: result.insertRowsRequested,
    created: result.created,
    skipped: result.skipped
  })
);
```

Keep all insert candidate logic, transaction boundaries, and `ignoreDuplicates` behavior unchanged.

- [ ] **Step 4: Re-run the duplicate-safe focused test files**

Run:

```bash
npm test -- --runTestsByPath tests/attendanceDuplicateSafety.test.js tests/createGeneralAlphaJobIdempotency.test.js tests/resolveWfaBookingsJobIdempotency.test.js --runInBand
```

Expected: PASS with request-path conflict semantics unchanged and job-path summary semantics now explicit and shared.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/createGeneralAlpha.job.js src/jobs/resolveWfaBookings.job.js tests/attendanceDuplicateSafety.test.js tests/createGeneralAlphaJobIdempotency.test.js tests/resolveWfaBookingsJobIdempotency.test.js
git commit -m "refactor: align duplicate-safe job summaries"
```

### Task 4: Run full verification and write the closure note

**Files:**
- Modify: `docs/superpowers/specs/2026-06-21-layer1-attendance-duplicate-safe-design.md`
- Modify: `docs/superpowers/plans/2026-06-21-layer1-duplicate-safe-hardening.md`
- Optional note target if used in this branch: `docs/` repo note or PR description draft in the branch workspace

**Interfaces:**
- Consumes:
  - completed code changes from Tasks 1-3
  - current design spec
- Produces:
  - fresh verification evidence
  - short closure addendum that maps results to INF-16 / INF-17 / INF-20 and explicitly calls out remaining Needs Verification

- [ ] **Step 1: Add a closure addendum section to the design spec**

Append this section to `docs/superpowers/specs/2026-06-21-layer1-attendance-duplicate-safe-design.md` after the current `## 12. Expected Output` section:

```md
## 13. Closure Addendum Template

When implementation is complete, record:

- request-path duplicate outcome stayed `409 conflict`
- job-path duplicate outcome stayed idempotent skip/no-op
- DB unique boundary stayed `attendance(user_id, attendance_date)`
- fresh verification commands executed successfully
- remaining hidden domain assumptions still deferred beyond duplicate-safe consistency
```

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: exit code `0`.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
npm test
```

Expected: exit code `0` and no regressions in attendance duplicate-safe tests.

- [ ] **Step 4: Record the actual verification evidence in the plan file**

Append this section to `docs/superpowers/plans/2026-06-21-layer1-duplicate-safe-hardening.md` after all tasks:

```md
## Verification Evidence

- `npm run lint` → PASS
- `npm test` → PASS
- `tests/attendanceDuplicateSafety.test.js` duplicate request conflict + duplicate job skip semantics remain green
- `tests/createGeneralAlphaJobIdempotency.test.js` duplicate-safe general alpha summaries remain green
- `tests/resolveWfaBookingsJobIdempotency.test.js` duplicate-safe unused WFA summaries remain green
- Closure note: INF-16 / INF-17 / INF-20 mapping preserved, with remaining hidden assumptions still marked Needs Verification
```

If either command fails, replace `PASS` with the actual failing command output summary and stop there.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-21-layer1-attendance-duplicate-safe-design.md docs/superpowers/plans/2026-06-21-layer1-duplicate-safe-hardening.md
git commit -m "docs: record Layer 1 duplicate-safe closure evidence"
```

## Self-Review

### Spec coverage

Covered spec requirements:

- explicit truth-boundary documentation → Tasks 1, 2, and 4
- small behavior-preserving hardening → Tasks 1, 2, and 3
- request/job/DB duplicate-safe consistency → Tasks 1, 2, and 3
- fresh verification evidence → Task 4
- closure note back to INF-16 / INF-17 / INF-20 → Task 4

No uncovered spec requirement remains for this limited hardening pass.

### Placeholder scan

- No `TODO`, `TBD`, or “appropriate handling” placeholders remain.
- Every code-changing step contains explicit code.
- Every execution step contains exact commands and expected outcomes.

### Type consistency

Consistent names used across tasks:

- `ATTENDANCE_DAILY_TRUTH_FIELDS`
- `ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE`
- `matchesAttendanceDailyTruthFields(...)`
- `buildDuplicateSafeJobSummary(...)`
- `isAttendanceDuplicateConstraintError(...)`
- `createAttendanceConflictError(...)`

No later task references a symbol not introduced in an earlier task.

## Verification Evidence

- `npm run lint` → PASS
- `npm test` → PASS
- `tests/attendanceDuplicateSafety.test.js` duplicate request conflict + duplicate job skip semantics remain green
- `tests/createGeneralAlphaJobIdempotency.test.js` duplicate-safe general alpha summaries remain green
- `tests/resolveWfaBookingsJobIdempotency.test.js` duplicate-safe unused WFA summaries remain green
- Closure note: INF-16 / INF-17 / INF-20 mapping preserved, with remaining hidden assumptions still marked Needs Verification
