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
| Example | GET | /api/example | authenticated route | 401 when anonymous | [fill in] | PASS / FAIL / Needs Verification |

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
