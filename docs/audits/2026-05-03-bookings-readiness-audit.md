# Bookings Readiness Audit — 2026-05-03

## Interim status (Task 4 repository evidence captured)
- This document now captures **Task 4 repository evidence** for bookings readiness across runtime routes, OpenAPI inventory, validators, controllers, and automated contract coverage.
- Live verification remains pending; repository evidence alone is not a final readiness result.
- Final readiness decision (`READY` or `NOT READY`) remains pending until Task 5 live verification and Task 6 final assessment are completed.

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
| `POST /api/bookings` | Yes — `verifyToken`, authenticated users | Yes — `/api/bookings` `post` | Yes — repository evidence captured | Yes — focused contract tests present | No — mutation live verification pending | Pending readiness | Safe live mutation path still required |
| `PATCH /api/bookings/{id}` | Yes — `verifyToken` plus Admin/Management `roleGuard` | Yes — `/api/bookings/{id}` documents `patch` | Yes — repository evidence captured | Yes — focused contract tests present | No — mutation live verification pending | Pending readiness | Safe live mutation path still required |
| `GET /api/bookings` | Yes — `verifyToken` plus Admin/Management `roleGuard` | Yes — `/api/bookings` documents `get` | Yes — repository evidence captured | Yes — focused contract tests present | Yes — read-only candidate, not yet performed | Pending live verification | Read-only live check still pending |
| `GET /api/bookings/history` | Yes — `verifyToken`, scoped to `req.user.id` | Yes — `/api/bookings/history` documents `get` with pagination/status/sort metadata | Yes — repository evidence captured | Yes — focused contract tests present | Yes — read-only candidate, not yet performed | Pending live verification | Read-only live check still pending |
| `DELETE /api/bookings/{id}` | Yes — `verifyToken` plus Admin/Management `roleGuard` | Yes — `/api/bookings/{id}` documents `delete` | Yes — repository evidence captured | Yes — focused contract tests present | No — mutation live verification pending | Pending readiness | Safe live mutation path still required |

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
- `router.use(verifyToken)` in `src/routes/booking.routes.js` protects all booking routes, including `PATCH /api/bookings/{id}`.
- The `PATCH /:id` route additionally mounts `roleGuard(['Admin', 'Management'])`, so only Admin/Management users can approve or reject bookings.

#### OpenAPI evidence
- `docs/openapi.yaml` defines `/api/bookings/{id}` and documents both operations on that path: `patch` and `delete`.
- The `patch` operation is documented as “Update booking status (Admin/Management only)” and includes `401`, `403`, and `404` responses.

#### Validator evidence
- `updateStatusValidation` only allows `approved` and `rejected` input values.

#### Controller evidence
- `updateBookingStatus` returns `404` when the requested booking record/ID does not exist and `400` for past-dated bookings.
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
- `router.use(verifyToken)` in `src/routes/booking.routes.js` protects `GET /api/bookings`.
- The `GET /` route additionally mounts `roleGuard(['Admin', 'Management'])`, so `GET /api/bookings` is Admin/Management only.

#### OpenAPI evidence
- `docs/openapi.yaml` documents `/api/bookings` `get` as “Get all bookings (Admin/Management only)”.
- The documented query parameters include pagination (`page`, `limit`), status filtering, date filters, and `user_id`; responses include `401` and `403`.

#### Validator evidence
- No route-level request validator is mounted for `GET /api/bookings`.

#### Controller evidence
- `getAllBookings` reads `status`, `page`, and `limit` query parameters.
- `getAllBookings` maps `approved`/`rejected`/`pending` status strings to persisted status IDs for filtering.
- `getAllBookings` queries bookings with user, position, role, location, and booking status relations.
- `getAllBookings` sorts pending first, then approved, then rejected, with newest records first inside each status group.
- `getAllBookings` returns flattened booking rows plus pagination metadata.

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
- `router.use(verifyToken)` in `src/routes/booking.routes.js` protects `GET /api/bookings/history`.
- The `GET /history` route has no Admin/Management `roleGuard`, so any authenticated user can reach it.
- `getBookingHistory` scopes its query with `whereClause = { user_id: req.user.id }`, so results are authenticated-user scoped.

#### OpenAPI evidence
- `docs/openapi.yaml` documents `/api/bookings/history` `get`.
- `GET /api/bookings/history` documents pagination parameters (`page`, `limit`), status filtering, sorting parameters (`sort_by`, `sort_order`), and response metadata for `pagination` plus `filters.status`, `filters.sort_by`, and `filters.sort_order`.

#### Validator evidence
- No route-level request validator is mounted for `GET /api/bookings/history`.

#### Controller evidence
- `getBookingHistory` validates pagination (`page >= 1`, `limit` between 1 and 100).
- `getBookingHistory` validates `status` against `approved`, `rejected`, and `pending` before mapping to persisted status IDs.
- `getBookingHistory` validates `sort_by` against `created_at`, `schedule_date`, `processed_at`, and `status`.
- `getBookingHistory` validates `sort_order` against `ASC` and `DESC`.
- `getBookingHistory` supports custom status ordering and otherwise sorts by the requested valid field.
- `getBookingHistory` returns transformed booking rows, pagination metadata, and filter/sort metadata.

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
- `router.use(verifyToken)` in `src/routes/booking.routes.js` protects all booking routes, including `DELETE /api/bookings/{id}`.
- The `DELETE /:id` route additionally mounts `roleGuard(['Admin', 'Management'])`, so only Admin/Management users can delete bookings.

#### OpenAPI evidence
- `docs/openapi.yaml` defines `/api/bookings/{id}` and documents both operations on that path: `patch` and `delete`.
- The `delete` operation is documented as “Delete booking (Admin/Management only)” and includes `401`, `403`, and `404` responses.

#### Validator evidence
- No route-level request-body validator is mounted for `DELETE /api/bookings/{id}`.

#### Controller evidence
- `deleteBooking` returns `404` when the requested booking record/ID does not exist.
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
- Decision: `PENDING`
- Reasoning:
  - Task 4 repository evidence is captured for runtime routes, OpenAPI documentation, validators, controllers, and automated contract tests.
  - Task 5 live verification has not started in this document, so mutation readiness and read-only live behavior remain unproven.
  - Task 6 must issue the final `READY` or `NOT READY` result after live evidence is available.

## Fix queue
1. Complete Task 5 live verification for read-only endpoints and safe mutation verification paths.
2. Complete Task 6 final readiness assessment with explicit `READY` or `NOT READY` decision.
