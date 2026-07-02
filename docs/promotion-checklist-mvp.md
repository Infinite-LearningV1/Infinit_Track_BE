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
- role-restricted route hit with insufficient privilege -> `403`
- intentionally absent/deprecated route -> `404`

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
| Auth | POST | /api/auth/login | public route | documented validation status | anonymous probe returned 400 | PASS |
| Auth | POST | /api/auth/refresh | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Auth | POST | /api/auth/logout | public route | documented public status | anonymous probe returned 200 | PASS |
| Auth | GET | /api/auth/me | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Attendance | GET | /api/attendance/today-locations | admin/management-only route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Attendance | GET | /api/attendance/geofence-evidence | admin/management-only route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Attendance | GET | /api/attendance | admin/management-only route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Attendance | POST | /api/attendance/check-in | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Attendance | POST | /api/attendance/checkout/{id} | authenticated route | 401 when anonymous | anonymous probe to `/api/attendance/checkout/1` returned 401 | PASS |
| Attendance | GET | /api/attendance/history | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Attendance | GET | /api/attendance/status-today | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Attendance | POST | /api/attendance/location-event | authenticated route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Attendance | POST | /api/attendance/research-trigger/daily | admin/management-only route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Attendance | POST | /api/attendance/research-trigger/full-day | admin/management-only route | 401 when anonymous | anonymous probe returned 401 | PASS |
| Attendance | DELETE | /api/attendance/{id} | admin/management-only route | 401 when anonymous | anonymous probe to `/api/attendance/1` returned 401 | PASS |
