# Reporting & Dashboard Analytics Boundary

## Why this exists
Infinite Track exposes three related but distinct read surfaces for reporting and dashboard analytics. This document explains which endpoint owns which use case so clients do not mix historical aggregates with current-day snapshots.

## Source of truth
- Runtime behavior in the backend is the final authority.
- `docs/openapi.yaml` is the detailed schema truth.
- This document is a consumer guide for endpoint boundary and intended usage.

## Endpoint decision matrix

| Use case | Endpoint | Why |
| --- | --- | --- |
| Historical attendance report, paginated rows, export payloads, legacy summary totals, and per-user attendance summary for the selected report window | `GET /api/summary/reports` | Canonical reporting/export surface. Uses dashboard-native report window semantics: period=daily, period=weekly, period=monthly, or period=range with from/to. Legacy 30d, current_month, and custom remain temporarily supported for backend compatibility. |
| Transitional access to the same reporting contract during consumer migration | `GET /api/summary` | Deprecated compatibility alias. Must stay behaviorally equivalent to `/api/summary/reports` for the same query. |
| Dashboard cards, historical trend, mode mix, geofence evidence context, insights, and lightweight FAHP snapshots | `GET /api/summary/dashboard-analytics` | Cockpit/dashboard aggregate surface. Returns top-level `requested_window` and `executed_window`, then section-based analytics under `data.*`; it does not own `map_context` or `today_locations`. |
| Today-only/live snapshot map for users who already checked in on the current Jakarta date | `GET /api/attendance/today-locations` | Dedicated operational snapshot surface for the current day. This is context-only map evidence, not a historical aggregation endpoint, final attendance authority, or fraud authority. |

## Dashboard analytics contract notes
- `requested_window` preserves raw client query intent.
- `executed_window` shows the effective historical window the backend actually executed after resolving defaults.
- `data.geofence_evidence_context` is contextual evidence only. Final attendance authority remains attendance records.
- `data.map_context` and `data.today_locations` are not part of the dashboard analytics contract in this phase.
- Clients that need today/live map points must call `/api/attendance/today-locations` directly.

## Consumer rules
- Use `/api/summary/reports` for reporting tables, exports, and `report.user_attendance_summary`.
- Use `q` as the canonical free-text search parameter for `/api/summary/reports` rows.
- Treat `search`, `query`, and `keyword` as deprecated compatibility aliases for `q`.
- Do not use `period=all` for `/api/summary/reports`; use `daily`, `weekly`, `monthly`, or `range`.
- Search filters `report.data` and `report.pagination`; top-level `summary` remains period-wide, while `analytics.discipline_analysis` reflects the visible report users on the current page.
- Treat `/api/summary` as a temporary deprecated alias during migration; it must return the same contract as `/api/summary/reports`.
- Use `/api/summary/dashboard-analytics` for dashboard analytics cards, charts, mode mix, geofence evidence context, insights, and FAHP snapshot panels.
- Use `/api/attendance/today-locations` for today-focused map widgets or hero maps.
- Do not pass `period`, `from`, or `to` to `/api/attendance/today-locations`; use `?limit=` only for display cap control.
- Do not treat `/api/summary/dashboard-analytics` as a substitute for reporting/export rows.
- Do not expect `data.map_context` or `data.today_locations` from `/api/summary/dashboard-analytics`.
- Do not treat `geofence_evidence_context` or today-locations map presence as final attendance truth or fraud evidence.

## Map View Contract
- Consumer: Web FE dashboard cockpit Map View.
- Endpoint: `GET /api/attendance/today-locations`.
- Scope: current Jakarta date only; this endpoint does not accept `period`, `from`, or `to` range filters.
- Optional cap: `?limit=` may request fewer returned locations, but the backend hard cap still applies.
- Authority: `authority: 'context_only'` and `final_attendance_authority: 'attendance_records'` mean the map is supporting context, not final attendance truth.
- Fraud boundary: map presence can explain dashboard context, but it must not be used as fraud authority or final-state evidence.
- Canceled route: do not introduce, document, or consume `/api/summary/dashboard-map` for this phase.

## Change management
Any future change to these three surfaces must keep runtime, tests, and `docs/openapi.yaml` aligned. If boundary intent changes, update this document in the same branch as the contract change.
