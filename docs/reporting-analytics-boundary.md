# Reporting & Dashboard Analytics Boundary

## Why this exists
Infinite Track exposes related but distinct read surfaces for reporting, dashboard analytics, current-day map context, and FAHP analysis. This document explains which endpoint owns which use case so clients do not mix historical aggregates, current-day snapshots, or FAHP evidence boundaries.

## Source of truth
- Runtime behavior in the backend is the final authority.
- `docs/openapi.yaml` is the detailed schema truth.
- This document is a consumer guide for endpoint boundary and intended usage.

## Endpoint decision matrix

| Use case | Endpoint | Why |
| --- | --- | --- |

| Historical attendance report browsing, paginated rows, legacy summary totals, and per-user attendance summary for the selected report window | `GET /api/summary/reports` | Canonical reporting surface. Uses dashboard-native report window semantics: period=daily, period=weekly, period=monthly, or period=range with from/to. Legacy 30d, current_month, and custom remain temporarily supported for backend compatibility. |
| PDF-oriented export payload projection from the shared reporting source | `GET /api/summary/reports/pdf` | Canonical PDF export contract. Shares the same backend report source logic as `/api/summary/reports`, but projects PDF-specific metadata, `period_summary`, `export_scope_summary`, and a flattened attendance table without report insight content. |
| Excel/workbook-oriented export payload projection from the shared reporting source | `GET /api/summary/reports/excel` | Canonical Excel export contract. Shares the same backend report source logic as `/api/summary/reports`, but projects workbook metadata, summary sheet data, attendance rows, and discipline insight rows with neutral `recommended_action_code` values. |
| Dashboard cards, historical trend, mode mix, insights, and lightweight FAHP snapshots | `GET /api/summary/dashboard-analytics` | Cockpit/dashboard aggregate surface for historical overview only. Returns top-level `requested_window` and `executed_window`, then section-based analytics under `data.*`; it does not own geofence evidence, `map_context`, or `today_locations`. |

| Geofence evidence snapshot for a selected historical attendance window | `GET /api/attendance/geofence-evidence` | Dedicated attendance-owned context surface for geofence enter/exit evidence. This is supporting evidence only; final attendance authority remains attendance records. |
| Today-only/live snapshot map for users who already checked in on the current Jakarta date | `GET /api/attendance/today-locations` | Dedicated operational snapshot surface for the current day. This is context-only map evidence, not a historical aggregation endpoint, final attendance authority, or fraud authority. |
| Dedicated FAHP analysis contracts | `GET /api/analysis/fuzzy-ahp/discipline`, `GET /api/analysis/fuzzy-ahp/wfa`, `GET /api/analysis/fuzzy-ahp/smart-ac` | Dedicated FAHP surfaces separate discipline evidence, live WFA provider validation, and Smart AC evidence sufficiency. The legacy combined endpoint remains transition-only. |
| Lightweight monthly FAHP dashboard recap | `GET /api/analysis/fuzzy-ahp/dashboard` | Additive recap-only dashboard surface. Accepts only `type` and is not the canonical detail-analysis contract. |

## Dashboard analytics contract notes
- `requested_window` preserves raw client query intent.
- `executed_window` shows the effective historical window the backend actually executed after resolving defaults.
- `data.geofence_evidence_context` is contextual evidence only. Final attendance authority remains attendance records.
- `data.geofence_evidence_context.operational_context` is UI-ready copy derived from geofence event counts, not a separate analytics authority.
- `data.map_context` and `data.today_locations` are not part of the dashboard analytics contract in this phase.
- Clients that need geofence evidence must call `/api/attendance/geofence-evidence` directly.
- Clients that need today/live map points must call `/api/attendance/today-locations` directly.

## Fuzzy AHP Endpoints Contract
- `GET /api/analysis/fuzzy-ahp` remains temporarily supported as the legacy combined endpoint for existing clients; compatibility is transition-only.
- Canonical dedicated production endpoints are:
  - `GET /api/analysis/fuzzy-ahp/discipline`
  - `GET /api/analysis/fuzzy-ahp/wfa`
  - `GET /api/analysis/fuzzy-ahp/smart-ac`
- `GET /api/analysis/fuzzy-ahp/dashboard` owns the lightweight monthly dashboard recap contract only; it is not the canonical detail-analysis surface.
- The recap may add display-friendly fields such as `type_label`, `consistency.summary_label`, and `criteria_weights[].display_label` without changing the underlying detail-analysis contract.
- The Postman collection `Infinite Track`, folder `FuzzyAhp`, is the primary manual smoke surface for the dedicated FAHP endpoints and contains curated Discipline, WFA, and Smart AC requests.
- Dedicated FAHP endpoint smoke requests require a Bearer token authorized for `Admin` or `Management` access.
- This repo document records only route ownership and source-of-truth boundary. Keep detailed per-endpoint validation, examples, and run guidance in Postman instead of duplicating a manual guide here; use the legacy combined endpoint only for explicit migration compatibility checks.

## Consumer rules
- Use `/api/summary/reports` for reporting tables, paginated report rows, `report.user_attendance_summary`, and the additive `period_summary` plus `export_scope_summary` fields.
- Use `/api/summary/reports/pdf` for PDF export payload preparation.
- Use `/api/summary/reports/excel` for workbook/Excel export payload preparation.
- Use `q` as the canonical free-text search parameter for `/api/summary/reports`, `/api/summary/reports/pdf`, and `/api/summary/reports/excel`.
- Treat `search`, `query`, and `keyword` as deprecated compatibility aliases for `q`.
- Do not use `period=all` for the summary reporting/export surface; use `daily`, `weekly`, `monthly`, or `range`.
- Search filters the export/report scope dataset; top-level legacy `summary` remains period-wide, while `analytics.discipline_analysis` on `/api/summary/reports` reflects the visible report users on the current page.
- `/api/summary` is no longer an active compatibility surface and must not be consumed or documented as an available GET route.
- Use `/api/summary/dashboard-analytics` for dashboard analytics cards, charts, mode mix, insights, and FAHP snapshot panels.
- Use `/api/attendance/geofence-evidence` for geofence evidence context panels bound to a historical attendance window.
- Use `/api/attendance/today-locations` for today-focused map widgets or hero maps.
- Do not pass `period`, `from`, or `to` to `/api/attendance/today-locations`; use `?limit=` only for display cap control.
- Use `/api/analysis/fuzzy-ahp/dashboard?type=...` only for lightweight monthly dashboard recap panels.
- Do not pass `period`, `from`, or `to` to `/api/analysis/fuzzy-ahp/dashboard`; only `type` is allowed.
- Do not treat `/api/summary/dashboard-analytics` as a substitute for reporting/export rows.
- Do not expect `data.map_context` or `data.today_locations` from `/api/summary/dashboard-analytics`.
- Do not treat `geofence_evidence_context`, `/api/attendance/geofence-evidence`, or today-locations map presence as final attendance truth or fraud evidence.
- Do not treat `/api/analysis/fuzzy-ahp/dashboard` as a canonical detail-analysis surface.

## Summary reporting field ownership
- `discipline_label` is an official detail/export attribute, not a report-summary attribute.
- `discipline_label` is available in `report.data[]` on `/api/summary/reports`.
- `discipline_label` is also available in `/api/summary/reports/excel` through `attendance_report_sheet[]` and `discipline_insight_sheet[]`.
- `discipline_label` is intentionally not promoted into `report.user_attendance_summary[]`; consumers that need discipline presentation at summary level must derive it from the dedicated detail/export surfaces or request a backend contract change.
- `needs_attention_users` is the official summary-report attention metric and lives under `period_summary` on `/api/summary/reports`, `/api/summary/reports/pdf`, and `/api/summary/reports/excel`.
- `needs_attention` remains a dashboard-analytics KPI under `/api/summary/dashboard-analytics`; it is not a synonym field on the summary report surface.
- If a runtime still serves `GET /api/summary` or fails to expose `/api/summary/reports/pdf` or `/api/summary/reports/excel`, treat that runtime as stale or non-canonical until deployment state is verified against the current backend release path.

## Map View Contract
- Consumer: Web FE dashboard cockpit Map View.
- Endpoint: `GET /api/attendance/today-locations`.
- Scope: current Jakarta date only; this endpoint does not accept `period`, `from`, or `to` range filters.
- Optional cap: `?limit=` may request fewer returned locations, but the backend hard cap still applies.
- Authority: `authority: 'context_only'` and `final_attendance_authority: 'attendance_records'` mean the map is supporting context, not final attendance truth.
- Fraud boundary: map presence can explain dashboard context, but it must not be used as fraud authority or final-state evidence.
- Canceled route: do not introduce, document, or consume `/api/summary/dashboard-map` for this phase.

## Change management
Any future change to these surfaces must keep runtime, tests, and `docs/openapi.yaml` aligned. If boundary intent changes, update this document in the same branch as the contract change.
