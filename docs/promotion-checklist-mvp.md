# Promotion Checklist MVP

## Purpose

Use this checklist before promoting backend changes from `develop` to `master`.

Source of truth for endpoint inventory:
- `docs/openapi.yaml`

Verification depth for this MVP:
- status-code contract only

Hard blocking rule:
- One endpoint without proof = block promotion

Decision model:
- Claude verdict
- Operator approval

## Endpoint Proof Rules

Each endpoint must be classified as one of:
- public route
- authenticated route
- role-restricted route
- admin/management-only route
- intentionally absent/deprecated route

Minimum proof examples:
- public route -> documented success or validation status (`200`, `201`, `400`, etc.)
- authenticated route hit anonymously -> `401`
- admin/management-only route (MVP minimum proof) -> `401` when anonymous
- role-restricted or ownership boundary route -> `403` when authenticated with insufficient privilege
- intentionally absent/deprecated route -> `404`

MVP simplification for this artifact:
- Admin/Management-only endpoints are treated as minimum protected-route proof only.
- For this MVP checklist, they are promotion-complete once anonymous access is rejected with `401`.
- Deeper insufficient-privilege `403` proof remains follow-up verification unless a route is explicitly tracked as an ownership/privilege boundary.

## Promotion Checklist Matrix

| Tag / Area | Method | Path | Classification | Expected Proof | Evidence | Status |
|---|---|---|---|---|---|---|
| Example | GET | /api/example | authenticated route | 401 when anonymous | example evidence: anonymous probe returned 401 | PASS |

If any row is missing evidence, the promotion candidate is not ready for `master`.

This MVP checklist does not prove full payload correctness or business-rule correctness; it only records status-code contract evidence for the endpoint inventory in `docs/openapi.yaml`.

## Scoped Proof Batch — Users, Bookings, Summary

This batch covers:
- Users
- Bookings
- Summary

Protected endpoints in this batch use anonymous `401` as the default minimum proof in this phase.

| Tag / Area | Method | Path | Classification | Expected Proof | Evidence | Status |
|---|---|---|---|---|---|---|
| Users | GET | /api/users | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Users | POST | /api/users | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Users | GET | /api/users/{id} | authenticated route | 401 when anonymous | anonymous probe to `/api/users/1` returned 401 | PASS |
| Users | PATCH | /api/users/{id} | authenticated route | 401 when anonymous | anonymous probe to `/api/users/1` returned 401 | PASS |
| Users | DELETE | /api/users/{id} | authenticated route | 401 when anonymous | anonymous probe to `/api/users/1` returned 401 | PASS |
| Users | POST | /api/users/{id}/photo | authenticated route | 401 when anonymous | anonymous probe to `/api/users/1/photo` returned 401 | PASS |
| Bookings | GET | /api/bookings | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Bookings | POST | /api/bookings | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Bookings | GET | /api/bookings/history | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Bookings | PATCH | /api/bookings/{id} | authenticated route | 401 when anonymous | anonymous probe to `/api/bookings/1` returned 401 | PASS |
| Bookings | DELETE | /api/bookings/{id} | authenticated route | 401 when anonymous | anonymous probe to `/api/bookings/1` returned 401 | PASS |
| Summary | GET | /api/summary/dashboard-analytics | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Summary | GET | /api/summary/reports | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Summary | GET | /api/summary/reports/pdf | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Summary | GET | /api/summary/reports/excel | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |

## Scoped Proof Batch — Auth, Attendance

This batch covers:
- Auth
- Attendance

Auth public endpoints use their minimum documented contract status.
Protected Auth endpoints and protected Attendance endpoints use anonymous `401` as the default minimum proof in this phase.

For this batch, public-by-contract auth endpoints use the minimum documented status expected by contract, and protected auth endpoints use anonymous `401`.

| Tag / Area | Method | Path | Classification | Expected Proof | Evidence | Status |
|---|---|---|---|---|---|---|
| Auth | POST | /api/auth/login | public route | documented validation status | 2026-07-02 anonymous probe returned 400 | PASS |
| Auth | POST | /api/auth/refresh | public route | documented rejection status | 2026-07-02 anonymous probe returned 401 | PASS |
| Auth | POST | /api/auth/logout | public route | documented public status | 2026-07-02 anonymous probe returned 200 | PASS |
| Auth | GET | /api/auth/me | authenticated route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |
| Attendance | GET | /api/attendance/today-locations | admin/management-only route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |
| Attendance | GET | /api/attendance/geofence-evidence | admin/management-only route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |
| Attendance | GET | /api/attendance | admin/management-only route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |
| Attendance | POST | /api/attendance/check-in | authenticated route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |
| Attendance | POST | /api/attendance/checkout/{id} | authenticated route | 401 when anonymous | 2026-07-02 anonymous probe to `/api/attendance/checkout/1` returned 401 | PASS |
| Attendance | GET | /api/attendance/history | authenticated route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |
| Attendance | GET | /api/attendance/status-today | authenticated route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |
| Attendance | POST | /api/attendance/location-event | authenticated route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |
| Attendance | POST | /api/attendance/research-trigger/daily | admin/management-only route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |
| Attendance | POST | /api/attendance/research-trigger/full-day | admin/management-only route | 401 when anonymous | 2026-07-02 anonymous probe returned 401 | PASS |
| Attendance | DELETE | /api/attendance/{id} | admin/management-only route | 401 when anonymous | 2026-07-02 anonymous probe to `/api/attendance/1` returned 401 | PASS |

## Scoped Proof Batch — Analysis, WFA, Discipline, Settings, Reference Data

This batch covers:
- Analysis
- WFA
- Discipline
- Settings
- Reference Data

Protected endpoints in this batch use anonymous `401` as the default minimum proof in this phase.
The endpoint inventory in this batch is derived from `docs/openapi.yaml`.

| Tag / Area | Method | Path | Classification | Expected Proof | Evidence | Status |
|---|---|---|---|---|---|---|
| Analysis | GET | /api/analysis/fuzzy-ahp | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| Analysis | GET | /api/analysis/fuzzy-ahp/discipline | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| Analysis | GET | /api/analysis/fuzzy-ahp/wfa | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| Analysis | GET | /api/analysis/fuzzy-ahp/smart-ac | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| Analysis | GET | /api/analysis/fuzzy-ahp/dashboard | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| WFA | GET | /api/wfa/recommendations | authenticated route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| WFA | GET | /api/wfa/ahp-config | authenticated route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| Discipline | GET | /api/discipline/all | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| Discipline | GET | /api/discipline/config | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| Settings | GET | /api/settings/operational | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| Settings | PATCH | /api/settings/operational | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| Reference Data | GET | /api/roles | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| Reference Data | GET | /api/programs | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| Reference Data | GET | /api/positions | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |
| Reference Data | GET | /api/divisions | admin/management-only route | 401 when anonymous | 2026-07-03 anonymous probe returned 401 | PASS |

### Known Contract Boundaries Still Requiring Verification

| Tag / Area | Method | Path | Classification | Expected Proof | Evidence | Status |
|---|---|---|---|---|---|---|
| Discipline | GET | /api/discipline/user/{userId} | ownership/privilege boundary on authenticated route | 401 when anonymous + 403 when authenticated non-owner without privilege | 2026-07-03 anonymous probe to `/api/discipline/user/1` returned 401; insufficient-privilege proof not yet recorded | FAIL |
| WFA | POST | /api/wfa/test-ahp | intentionally excluded debug/test route | Keep excluded from public OpenAPI inventory unless contract owner says otherwise | Path is listed in `tests/openApiMountedRoutesContract.test.js` `excludedPaths` and is not represented in `docs/openapi.yaml` | Needs Verification |
| Discipline | POST | /api/discipline/test-ahp | intentionally excluded debug/test route | Keep excluded from public OpenAPI inventory unless contract owner says otherwise | Path is listed in `tests/openApiMountedRoutesContract.test.js` `excludedPaths` and is not represented in `docs/openapi.yaml` | Needs Verification |

Needs Verification:
- Record insufficient-privilege `403` evidence for `GET /api/discipline/user/{userId}` before treating the endpoint as promotion-complete.
- Confirm whether `POST /api/wfa/test-ahp` should remain an internal-only route outside the public OpenAPI contract.
- Confirm whether `POST /api/discipline/test-ahp` should remain an internal-only route outside the public OpenAPI contract.
