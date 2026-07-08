# INF-233 — Attendance History Report Summary Contract Design

## Status

Draft for implementation in isolated branch/worktree:

```text
feature/inf-233-attendance-history-report-summary
```

## Goal

Align `GET /api/attendance/history` with Android **My Attendance Report** summary UI while preserving the INF-217 timeline contract and existing backend response fields.

Primary Android UI needs:

```text
Attendance Rate
Work Hours
Late count
Alpha count
WFO/WFA/WFH distribution
Timeline status display without misleading alpha times
```

## Endpoint

```http
GET /api/attendance/history?period=monthly&page=1&limit=3
```

No new endpoint.

## Source facts from current code/runtime

Current `data.summary` already includes:

```text
total_ontime
total_late
total_early
total_alpha
total_wfo
total_wfa
total_wfh
total_work_hours
```

Current timeline rows already include INF-217 fields:

```text
id_attendance
attendance_date
date
monthYear
date_label
mode_key
mode_label
time_in
time_out
time_range
work_hour
work_hour_raw
status_key
status_label
display_badge_key
display_badge_label
location_label
category
status
location
notes
```

Current issue: alpha rows can expose system-generated timestamps in UI fields, for example:

```json
{
  "status_key": "alpha",
  "time_in": "23:55",
  "time_out": "23:55",
  "time_range": "23:55 - 23:55"
}
```

This is misleading for Android UI because alpha is absence, not a valid work session.

## Non-goals

Do not:

- Change endpoint path.
- Remove existing fields.
- Implement Android UI.
- Add Personal Insight / recommendation text.
- Add PDF export behavior.
- Change attendance final-state semantics.
- Add `Active Session` to `attendance_statuses`.
- Introduce an official business-calendar denominator without reliable source.

## Required additive summary fields

Add these fields under `data.summary`:

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

### Formula

MVP counted-days formula:

```text
total_present = total_ontime + total_late + total_early
total_absent = total_alpha
total_counted_days = total_present + total_absent
attendance_rate = round((total_present / total_counted_days) * 100)
attendance_rate_label = `${attendance_rate}%`
attendance_rate_denominator = "total_counted_days"
```

When `total_counted_days === 0`:

```json
{
  "attendance_rate": null,
  "attendance_rate_label": "N/A",
  "attendance_rate_denominator": "total_counted_days"
}
```

### Working-day denominator

For INF-233:

```json
"total_working_days": null
```

Reason: backend must not fabricate official working days from counted attendance rows. If product later needs official working-day denominator, implement it from reliable business calendar / operational settings in a separate issue.

## Required mode distribution

Add `summary.mode_distribution`:

```json
{
  "total": 3,
  "wfo": {
    "key": "wfo",
    "label": "WFO",
    "count": 3,
    "percentage": 100
  },
  "wfa": {
    "key": "wfa",
    "label": "WFA",
    "count": 0,
    "percentage": 0
  },
  "wfh": {
    "key": "wfh",
    "label": "WFH",
    "count": 0,
    "percentage": 0
  }
}
```

Formula:

```text
distribution_total = total_wfo + total_wfa + total_wfh
percentage = distribution_total > 0 ? round((count / distribution_total) * 100) : 0
```

## Alpha timeline display contract

For rows where `status_key === "alpha"`, UI-facing time fields must be safe:

```json
{
  "time_in": null,
  "time_out": null,
  "time_range": "--:-- - --:--",
  "work_hour": null,
  "work_hour_raw": 0
}
```

Preserve raw system-generated values additively:

```json
{
  "raw_time_in": "23:55",
  "raw_time_out": "23:55",
  "raw_time_range": "23:55 - 23:55"
}
```

For non-alpha rows, raw time fields mirror display time values:

```json
{
  "raw_time_in": "08:00",
  "raw_time_out": "17:00",
  "raw_time_range": "08:00 - 17:00"
}
```

Rationale:

- Android should consume `time_in`, `time_out`, and `time_range` directly for UI display.
- Raw fields remain available for audit/debugging if backend generated system timestamps for alpha.

## Example expected response fragment

```json
{
  "success": true,
  "data": {
    "summary": {
      "total_ontime": 2,
      "total_late": 0,
      "total_early": 0,
      "total_alpha": 1,
      "total_present": 2,
      "total_absent": 1,
      "total_counted_days": 3,
      "total_working_days": null,
      "attendance_rate": 67,
      "attendance_rate_label": "67%",
      "attendance_rate_denominator": "total_counted_days",
      "total_wfo": 3,
      "total_wfa": 0,
      "total_wfh": 0,
      "total_work_hours": 16,
      "total_work_hours_label": "16h",
      "mode_distribution": {
        "total": 3,
        "wfo": { "key": "wfo", "label": "WFO", "count": 3, "percentage": 100 },
        "wfa": { "key": "wfa", "label": "WFA", "count": 0, "percentage": 0 },
        "wfh": { "key": "wfh", "label": "WFH", "count": 0, "percentage": 0 }
      }
    },
    "attendances": [
      {
        "status_key": "alpha",
        "status_label": "Alpha",
        "display_badge_key": "alpha",
        "display_badge_label": "Alpha",
        "time_in": null,
        "time_out": null,
        "time_range": "--:-- - --:--",
        "raw_time_in": "23:55",
        "raw_time_out": "23:55",
        "raw_time_range": "23:55 - 23:55",
        "work_hour": null,
        "work_hour_raw": 0
      }
    ]
  },
  "message": "Riwayat absensi berhasil diambil"
}
```

## Backward compatibility

Keep all existing fields:

```text
summary.total_ontime
summary.total_late
summary.total_early
summary.total_alpha
summary.total_wfo
summary.total_wfa
summary.total_wfh
summary.total_work_hours
row.date
row.monthYear
row.category
row.status
row.location
row.notes
```

Value-level change:

- For alpha rows, UI-facing `time_in`, `time_out`, and `time_range` become safe display values.
- Raw system timestamps move to `raw_time_*` fields.

This is treated as a correctness fix for UI contract, not a final-state mutation.

## Acceptance criteria

- `data.summary.attendance_rate` exists.
- `data.summary.attendance_rate_label` exists.
- `data.summary.attendance_rate_denominator` exists and is `total_counted_days`.
- `data.summary.total_present`, `total_absent`, and `total_counted_days` exist.
- `data.summary.total_working_days` exists and is `null` for INF-233 MVP.
- `data.summary.total_work_hours_label` exists.
- `data.summary.mode_distribution` exists with WFO/WFA/WFH count and percentage.
- Existing summary fields remain.
- Alpha rows expose UI-safe `time_in`, `time_out`, and `time_range`.
- Alpha rows preserve raw values in `raw_time_in`, `raw_time_out`, `raw_time_range`.
- Contract tests cover rate formula, denominator, mode distribution, and alpha display behavior.
- OpenAPI is updated.
- Postman evidence for `period=monthly&page=1&limit=3` is provided after implementation/deploy.

## Verification commands

```bash
npm test -- --runTestsByPath tests/attendanceHistoryTimelineContract.test.js
npm run lint
npm test
```

Runtime evidence:

```http
GET /api/attendance/history?period=monthly&page=1&limit=3
Authorization: Bearer <token>
```
