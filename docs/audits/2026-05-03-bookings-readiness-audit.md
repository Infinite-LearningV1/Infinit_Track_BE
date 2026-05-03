# Bookings Readiness Audit — 2026-05-03

## Draft status (scaffold)
- This document is currently a **draft scaffold** for Task 1 structure and quality alignment.
- `TBD` placeholders in the matrix and endpoint sections indicate **evidence not yet captured**, not a final readiness result.
- Final readiness decisions (`READY` or `NOT READY`) remain pending until later evidence capture is completed.

## Scope audited
- `POST /api/bookings`
- `PATCH /api/bookings/{id}`
- `GET /api/bookings`
- `GET /api/bookings/history`
- `DELETE /api/bookings/{id}`

## Audit standard
- Final outcome must be either `READY` or `NOT READY`.
- Mutation endpoints must have sufficient live verification evidence to count toward `READY`.
- Read-only endpoint health does not override missing live evidence for mutation flows.

## Current constraints (for live-verifiable assessment)
- This audit currently assumes **read-only live verification on staging**.
- Under this constraint, live checks can validate read endpoints and non-mutating access patterns.
- Mutation flows (`POST`/`PATCH`/`DELETE`) require **separate live mutation evidence** to count as ready.

## Verification matrix

| Endpoint | Auth/RBAC aligned | OpenAPI aligned | Business rules aligned | Automated coverage sufficient | Live-verifiable under current constraints | Endpoint status | Blocking notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /api/bookings` | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| `PATCH /api/bookings/{id}` | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| `GET /api/bookings` | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| `GET /api/bookings/history` | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| `DELETE /api/bookings/{id}` | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## Findings by endpoint

### `POST /api/bookings`
#### Runtime evidence
- Route mounted at `POST /api/bookings` in `src/routes/booking.routes.js`.
- Protected by `verifyToken`, but not by admin-only `roleGuard`.

#### OpenAPI evidence
- Public contract exists in `docs/openapi.yaml` under `/api/bookings` `post`.
- Request body currently requires `schedule_date`, `latitude`, and `longitude`.

#### Validator evidence
- `createBookingValidation` requires `schedule_date`, `latitude`, and `longitude`.
- Optional request fields include `radius`, `description`, and `notes`.

#### Controller evidence
- `createBooking` rejects past dates, same-day dates, and duplicate pending/approved bookings on the same date.
- `createBooking` can either reuse `location_id` or create a new `Location` record.
- Success response returns `booking_id`, `schedule_date`, `location_id`, `status`, `suitability_score`, and `suitability_label`.

#### Automated verification evidence
- `tests/bookingsReadinessContract.test.js` verifies authenticated non-admin users can reach booking creation while unauthenticated requests are blocked by `verifyToken`.
- `tests/bookingsReadinessContract.test.js` verifies `createBookingValidation` rejects missing `schedule_date`, invalid/missing/zero `latitude`, and invalid/missing/zero `longitude`.
- `tests/openApiMountedRoutesContract.test.js` verifies `/api/bookings` remains present in the public OpenAPI inventory.

#### Live verification evidence
- TBD; Task 4 records repository evidence only and does not perform live mutation verification.

#### Status
- Repository evidence present; live mutation verification still required for readiness.

#### Blocking notes
- Mutation readiness remains unproven until a safe live `POST /api/bookings` verification path exists.

### `PATCH /api/bookings/{id}`
#### Runtime evidence
- Endpoint is protected by `verifyToken` and admin/management-only `roleGuard`.

#### OpenAPI evidence
- `/api/bookings/{id}` documents the `patch` operation.

#### Validator evidence
- `updateStatusValidation` only allows `approved` and `rejected` input values.

#### Controller evidence
- `updateBookingStatus` rejects missing booking IDs with `404` and past-dated bookings with `400`.
- `updateBookingStatus` records `approved_by`, `processed_at`, and maps `approved`/`rejected` to persisted status IDs.

#### Automated verification evidence
- `tests/bookingsReadinessContract.test.js` verifies authenticated non-admin users are blocked from `PATCH /api/bookings/{id}` with `403`.
- `tests/bookingsReadinessContract.test.js` verifies unauthenticated requests are blocked by `verifyToken` before reaching `PATCH /api/bookings/{id}`.
- `tests/bookingsReadinessContract.test.js` verifies `approved` and `rejected` status values pass validation, while any other status returns `400`.
- `tests/openApiMountedRoutesContract.test.js` verifies `/api/bookings/{id}` remains present in the public OpenAPI inventory.

#### Live verification evidence
- TBD; Task 4 records repository evidence only and does not perform live mutation verification.

#### Status
- Repository evidence present; live mutation verification still required for readiness.

#### Blocking notes
- Mutation readiness remains unproven until a safe live `PATCH /api/bookings/{id}` verification path exists.

### `GET /api/bookings`
#### Runtime evidence
- `GET /api/bookings` is admin/management only.

#### OpenAPI evidence
- Endpoint is documented in `docs/openapi.yaml`.

#### Validator evidence
- No route-level request validator is mounted for `GET /api/bookings`.

#### Controller evidence
- `getAllBookings` supports status filtering and paginated flattened responses.

#### Automated verification evidence
- `tests/bookingsReadinessContract.test.js` verifies authenticated non-admin users are blocked from `GET /api/bookings` with `403`.
- `tests/bookingsReadinessContract.test.js` verifies unauthenticated requests are blocked by `verifyToken` before reaching `GET /api/bookings`.
- `tests/openApiMountedRoutesContract.test.js` verifies `/api/bookings` remains present in the public OpenAPI inventory.

#### Live verification evidence
- TBD; Task 4 records repository evidence only and does not perform live read-only verification.

#### Status
- Repository and live read-only verification candidate.

#### Blocking notes
- Read-only live verification remains pending for final readiness evidence.

### `GET /api/bookings/history`
#### Runtime evidence
- `GET /api/bookings/history` is available to any authenticated user and scopes results to `req.user.id`.

#### OpenAPI evidence
- Endpoint is documented in `docs/openapi.yaml`.
- `GET /api/bookings/history` documents pagination, status filtering, and sorting metadata.

#### Validator evidence
- No route-level request validator is mounted for `GET /api/bookings/history`.

#### Controller evidence
- `getBookingHistory` validates `page`, `limit`, `status`, `sort_by`, and `sort_order`.

#### Automated verification evidence
- `tests/bookingsReadinessContract.test.js` verifies authenticated users can reach `GET /api/bookings/history`.
- `tests/bookingsReadinessContract.test.js` verifies unauthenticated requests are blocked by `verifyToken` before reaching `GET /api/bookings/history`.
- `tests/openApiMountedRoutesContract.test.js` verifies `/api/bookings/history` remains present in the public OpenAPI inventory.

#### Live verification evidence
- TBD; Task 4 records repository evidence only and does not perform live read-only verification.

#### Status
- Repository and live read-only verification candidate.

#### Blocking notes
- Read-only live verification remains pending for final readiness evidence.

### `DELETE /api/bookings/{id}`
#### Runtime evidence
- Endpoint is protected by `verifyToken` and admin/management-only `roleGuard`.

#### OpenAPI evidence
- `/api/bookings/{id}` documents the `delete` operation.

#### Validator evidence
- No route-level request-body validator is mounted for `DELETE /api/bookings/{id}`.

#### Controller evidence
- `deleteBooking` rejects missing booking IDs with `404`.
- `deleteBooking` deletes the booking record and then deletes the related location record inside the same transaction.

#### Automated verification evidence
- `tests/bookingsReadinessContract.test.js` verifies authenticated non-admin users are blocked from `DELETE /api/bookings/{id}` with `403`.
- `tests/bookingsReadinessContract.test.js` verifies unauthenticated requests are blocked by `verifyToken` before reaching `DELETE /api/bookings/{id}`.
- `tests/openApiMountedRoutesContract.test.js` verifies `/api/bookings/{id}` remains present in the public OpenAPI inventory.

#### Live verification evidence
- TBD; Task 4 records repository evidence only and does not perform live mutation verification.

#### Status
- Repository evidence present; live mutation verification still required for readiness.

#### Blocking notes
- Mutation readiness remains unproven until a safe live `DELETE /api/bookings/{id}` verification path exists.

## Automated verification evidence
- `tests/bookingsReadinessContract.test.js` verifies route/auth boundaries and exported validator contract shape.
- `tests/openApiMountedRoutesContract.test.js` verifies the bookings paths remain present in the public OpenAPI inventory.

## Initial endpoint status posture
- `POST /api/bookings`: repository evidence present, live mutation verification still required for readiness.
- `PATCH /api/bookings/{id}`: repository evidence present, live mutation verification still required for readiness.
- `GET /api/bookings`: repository and live read-only verification candidate.
- `GET /api/bookings/history`: repository and live read-only verification candidate.
- `DELETE /api/bookings/{id}`: repository evidence present, live mutation verification still required for readiness.

## Blocking gap list
### Contract gaps
### Logic gaps
### Automated verification gaps
### Live verification gaps

## Final readiness decision
- Decision: `TBD`
- Reasoning:
  - TBD

## Fix queue
1. TBD
