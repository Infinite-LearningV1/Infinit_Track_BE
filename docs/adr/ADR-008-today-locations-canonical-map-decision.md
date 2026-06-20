# ADR-008: Today Locations Canonical Map Decision

Status: Accepted
Date: 2026-05-29

## Context

Infinite Track needs a dashboard map surface that can render users who have checked in today, without mixing that operational snapshot with historical reporting or cockpit analytics aggregates.

The backend is the final authority for attendance state. Map presence is useful context for the current Jakarta date, but it must not become a second source of truth for final attendance, historical analysis, or fraud decisions.

The cancelled `GET /api/summary/dashboard-map` proposal would have put map ownership under summary/dashboard analytics. That would blur the boundary between range-aware analytics and today/live operational snapshots.

## Decision

The canonical map endpoint is `GET /api/attendance/today-locations`.

This endpoint returns a render-ready snapshot of checked-in user locations for the current Jakarta date only. It is today/live map context, not a historical or range-aware endpoint.

The response contract explicitly marks the data as supporting context:

- `snapshot_type: attendance_checkin_snapshot`
- `is_live_tracking: false`
- `authority: context_only`
- `final_attendance_authority: attendance_records`
- `truncated`
- `truncated_at`

The endpoint accepts only `?limit=<positive integer>` for display cap control. It does not accept `period`, `from`, or `to`.

`GET /api/summary/dashboard-map` remains cancelled and must not be implemented or documented for this phase.

## Boundary

`GET /api/summary/reports` owns reporting and export use cases.

`GET /api/summary` remains a deprecated compatibility alias for the report contract.

`GET /api/summary/dashboard-analytics` owns range-aware dashboard cockpit aggregates. It must not own `today_locations` or `map_context` runtime response fields.

`GET /api/attendance/today-locations` owns today-only map snapshots. Clients must not treat this data as final attendance authority or fraud authority.

## Consequences

- Web dashboard map widgets should call `GET /api/attendance/today-locations` directly.
- Reporting, exports, historical summaries, and final attendance state must continue to use attendance records and summary/reporting endpoints.
- Dashboard analytics can include contextual evidence sections, but it must not embed today/live map points.
- OpenAPI and boundary docs must keep the cancelled `/api/summary/dashboard-map` endpoint absent.
- Future map changes that alter route ownership, query semantics, response authority fields, or final-state interpretation require docs and contract-test updates in the same branch.

## Verification

The decision is covered by:

- route and handler contract tests for `GET /api/attendance/today-locations`;
- route validation tests for `?limit` rejection before handler execution;
- OpenAPI contract tests asserting today-locations metadata and no cancelled dashboard-map path;
- local sanitized runtime smoke evidence in `docs/today-locations-evidence/RUN_2026-05-29.md`.
