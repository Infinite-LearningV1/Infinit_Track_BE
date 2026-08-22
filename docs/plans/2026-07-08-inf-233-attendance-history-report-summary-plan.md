# INF-233 — Attendance History Report Summary Implementation Plan

## Worktree / Branch

```text
Worktree: C:/Users/Febriyadi/.claude/worktrees/Infinit_Track_BE-feature-inf-233-attendance-history-report-summary
Branch: feature/inf-233-attendance-history-report-summary
Base: develop @ a462663
```

## Scope

Implement additive report summary fields and alpha UI-safe timeline display for:

```http
GET /api/attendance/history
```

No new endpoint and no DB migration.

## Files to change

Required:

```text
src/controllers/attendance.controller.js
tests/attendanceHistoryTimelineContract.test.js
docs/openapi.yaml
```

Optional after implementation:

```text
postman/inf-217-attendance-history-runtime.collection.json
```

Only update Postman if we decide to track INF-233 evidence in repo.

## Design decisions locked

### Attendance rate denominator

Use MVP counted-days denominator:

```text
total_present = total_ontime + total_late + total_early
total_absent = total_alpha
total_counted_days = total_present + total_absent
attendance_rate = round((total_present / total_counted_days) * 100)
```

When no counted days:

```json
{
  "attendance_rate": null,
  "attendance_rate_label": "N/A",
  "attendance_rate_denominator": "total_counted_days"
}
```

### Working days

Return:

```json
"total_working_days": null
```

Reason: no reliable official working-day denominator in this issue.

### Alpha display

For `status_key === "alpha"`:

```json
{
  "time_in": null,
  "time_out": null,
  "time_range": "--:-- - --:--",
  "raw_time_in": "23:55",
  "raw_time_out": "23:55",
  "raw_time_range": "23:55 - 23:55",
  "work_hour": null
}
```

For non-alpha rows, raw time fields mirror display values.

## Implementation steps

### Step 1 — Add focused failing tests

File:

```text
tests/attendanceHistoryTimelineContract.test.js
```

Add tests for:

1. Summary report fields with example totals:

```text
total_ontime=2
total_late=0
total_early=0
total_alpha=1
total_wfo=3
total_wfa=0
total_wfh=0
total_work_hours=16
```

Expect:

```json
{
  "total_present": 2,
  "total_absent": 1,
  "total_counted_days": 3,
  "total_working_days": null,
  "attendance_rate": 67,
  "attendance_rate_label": "67%",
  "attendance_rate_denominator": "total_counted_days",
  "total_work_hours_label": "16h"
}
```

2. `mode_distribution`:

```json
{
  "total": 3,
  "wfo": { "count": 3, "percentage": 100 },
  "wfa": { "count": 0, "percentage": 0 },
  "wfh": { "count": 0, "percentage": 0 }
}
```

3. Empty-count edge case:

```text
total_counted_days=0
attendance_rate=null
attendance_rate_label=N/A
mode_distribution.total=0
percentages=0
```

4. Alpha UI-safe row:

Input row has system time values.

Expect:

```json
{
  "time_in": null,
  "time_out": null,
  "time_range": "--:-- - --:--",
  "raw_time_in": "23:55",
  "raw_time_out": "23:55",
  "raw_time_range": "23:55 - 23:55",
  "work_hour": null
}
```

Run expected failing test:

```bash
npm test -- --runTestsByPath tests/attendanceHistoryTimelineContract.test.js
```

### Step 2 — Implement summary helpers

File:

```text
src/controllers/attendance.controller.js
```

Add helper functions near existing attendance history helpers:

```js
const roundPercentage = (value) => Math.round(value);
const formatWorkHoursLabel = (hours) => ...;
const percentageOf = (count, total) => ...;
const buildModeDistribution = (summary) => ...;
const enrichHistorySummaryForReport = (summary) => ...;
```

Implementation details:

- `total_present = total_ontime + total_late + total_early`
- `total_absent = total_alpha`
- `total_counted_days = total_present + total_absent`
- `total_working_days = null`
- `attendance_rate = null` if denominator 0, else rounded integer
- `attendance_rate_label = "N/A"` if null, else `${attendance_rate}%`
- `attendance_rate_denominator = "total_counted_days"`
- `total_work_hours_label`: compact Android display helper:
  - `0` → `0h`
  - integer `16` → `16h`
  - decimal `16.5` → `16h 30m`

### Step 3 — Apply summary enrichment after existing counts

In `getAttendanceHistory`, after current summary counts and `total_work_hours` assignment, apply helper:

```js
const reportSummary = enrichHistorySummaryForReport(summary);
```

Then return `summary: reportSummary`.

Avoid mutating final attendance state or database.

### Step 4 — Harden alpha row time display

In timeline transformation:

1. Compute raw formatted values first:

```js
const rawTimeIn = att.time_in ? formatTimeOnly(att.time_in) : null;
const rawTimeOut = att.time_out ? formatTimeOnly(att.time_out) : null;
const rawTimeRange = `${rawTimeIn || '--:--'} - ${rawTimeOut || '--:--'}`;
```

2. For alpha:

```js
const timeIn = isAlpha ? null : rawTimeIn;
const timeOut = isAlpha ? null : rawTimeOut;
const timeRange = isAlpha ? '--:-- - --:--' : rawTimeRange;
```

3. Return raw fields additively:

```js
raw_time_in: rawTimeIn,
raw_time_out: rawTimeOut,
raw_time_range: rawTimeRange
```

Keep `work_hour: null` for alpha as already implemented.

### Step 5 — Update OpenAPI

File:

```text
docs/openapi.yaml
```

Update `GET /api/attendance/history` response schema:

Add summary properties:

```text
total_present
total_absent
total_counted_days
total_working_days
attendance_rate
attendance_rate_label
attendance_rate_denominator
total_work_hours_label
mode_distribution
```

Update row schema:

```text
raw_time_in
raw_time_out
raw_time_range
```

Clarify alpha behavior in descriptions:

```text
For alpha rows, UI-facing time_in/time_out are null and time_range is "--:-- - --:--". Raw system timestamps, when present, are available in raw_time_* fields.
```

### Step 6 — Verification

Run focused test:

```bash
npm test -- --runTestsByPath tests/attendanceHistoryTimelineContract.test.js
```

Run lint:

```bash
npm run lint
```

Run full tests:

```bash
npm test
```

Diff hygiene:

```bash
git diff --check
```

### Step 7 — Runtime evidence after merge/deploy

After PR merge and runtime rebuild/deploy:

```http
GET /api/attendance/history?period=monthly&page=1&limit=3
Authorization: Bearer <token>
```

Capture evidence for:

- `attendance_rate`
- denominator fields
- `total_work_hours_label`
- `mode_distribution`
- alpha row UI-safe `time_in/time_out/time_range`
- alpha row raw fields

## Risks and mitigations

### Risk: Android already uses `time_in` for alpha

Mitigation:

- This change intentionally makes `time_in` UI-safe for alpha.
- Raw values are preserved in `raw_time_*`.
- Tests document the behavior.

### Risk: `total_working_days=null` may surprise UI

Mitigation:

- Provide `total_counted_days` and `attendance_rate_denominator` explicitly.
- Android should display counted-days rate for MVP.
- Official working days can be separate future issue.

### Risk: Mode distribution duplicates totals

Mitigation:

- It is additive and derived directly from existing totals.
- Existing totals remain backward-compatible.

## Definition of done

- Spec and plan exist.
- Controller implements additive summary fields and alpha display hardening.
- OpenAPI updated.
- Focused tests pass.
- Lint and full tests pass.
- PR body includes verification evidence and runtime follow-up.

## PR notes draft

```md
## Summary
- Extend GET /api/attendance/history summary with Android My Attendance report fields.
- Add counted-days attendance_rate and denominator metadata.
- Add total_present, total_absent, total_counted_days, total_working_days=null, total_work_hours_label, and mode_distribution.
- Harden alpha timeline rows so UI-facing time fields do not show system-generated fake times.
- Preserve raw alpha timestamps in raw_time_* fields.
- Update OpenAPI and contract tests.

## Verification
- npm test -- --runTestsByPath tests/attendanceHistoryTimelineContract.test.js
- npm run lint
- npm test
- git diff --check

## Runtime follow-up
- Postman evidence for GET /api/attendance/history?period=monthly&page=1&limit=3
```
