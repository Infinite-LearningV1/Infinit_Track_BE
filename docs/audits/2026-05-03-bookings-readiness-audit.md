# Bookings Readiness Audit — 2026-05-03

## Final status (Task 6 readiness assessment captured)
- This document captures **Task 4 repository evidence**, **Task 5 live verification findings**, and the **Task 6 final readiness assessment** for bookings readiness.
- Fact: current repository evidence closes the earlier `GET /api/bookings` filter-mismatch concern and the earlier `DELETE /api/bookings/{id}` shared-location deletion concern.
- Fact: unauthenticated live `GET` access to the bookings read endpoints is blocked with `401`.
- Fact: authenticated live `GET` verification was not completed from this session because no valid live token could be obtained from available local credential sources without guessing.
- Fact: live mutation verification for `POST`/`PATCH`/`DELETE` remains intentionally not performed because mutating staging actions are disallowed under the current constraint.
- Final readiness decision is now issued as `NOT READY` because the required live evidence for authenticated read behavior and mutation flows is still incomplete under this audit standard.

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
| `POST /api/bookings` | Yes — `verifyToken`, authenticated users | Yes — `/api/bookings` `post` | Yes — repository evidence captured | Yes — focused contract tests present | No — live mutation verification disallowed by current constraint | Pending readiness | Safe live mutation path still required |
| `PATCH /api/bookings/{id}` | Yes — `verifyToken` plus Admin/Management `roleGuard` | Yes — `/api/bookings/{id}` documents `patch` | Yes — repository evidence captured | Yes — focused contract tests present | No — live mutation verification disallowed by current constraint | Pending readiness | Safe live mutation path still required |
| `GET /api/bookings` | Yes — `verifyToken` plus Admin/Management `roleGuard` | Yes — OpenAPI filter contract matches current `getAllBookings` implementation | Yes — repository evidence captured | Yes — focused contract tests present | Partial — unauthenticated live access verified blocked with `401`; authenticated live verification not completed | Pending authenticated live verification | No authenticated live read evidence |
| `GET /api/bookings/history` | Yes — `verifyToken`, scoped to `req.user.id` | Yes — `/api/bookings/history` documents `get` with pagination/status/sort metadata | Yes — repository evidence captured | Yes — focused contract tests present | Partial — unauthenticated live access verified blocked with `401`; authenticated live verification not completed | Pending authenticated live verification | No authenticated live read evidence |
| `DELETE /api/bookings/{id}` | Yes — `verifyToken` plus Admin/Management `roleGuard` | Yes — `/api/bookings/{id}` documents `delete` | Yes — repository evidence captured and current delete flow does not remove `Location` records | Yes — focused contract tests present | No — live mutation verification disallowed by current constraint | Pending live mutation verification | Safe live mutation path still required |

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
- Fact: live mutation verification was not performed for `POST /api/bookings` because mutating staging actions are disallowed under the current audit constraint.

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
- Fact: live mutation verification was not performed for `PATCH /api/bookings/{id}` because mutating staging actions are disallowed under the current audit constraint.

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
- `getAllBookings` reads `status`, `page`, `limit`, `user_id`, `date_from`, and `date_to` query parameters.
- `getAllBookings` validates positive-integer pagination and enforces an admin safety cap of `limit <= 100`.
- `getAllBookings` validates `user_id` as a positive integer and validates `date_from`/`date_to` as strict `YYYY-MM-DD` values with an ordered date-range check.
- `getAllBookings` maps `approved`/`rejected`/`pending` status strings to persisted status IDs for filtering.
- `getAllBookings` queries bookings with user, position, role, location, and booking status relations.
- `getAllBookings` sorts pending first, then approved, then rejected, with newest records first inside each status group.
- `getAllBookings` returns flattened booking rows plus pagination metadata.

#### Automated verification evidence
- `tests/bookingsReadinessContract.test.js` verifies authenticated non-admin users are blocked from `GET /api/bookings` with `403`.
- `tests/bookingsReadinessContract.test.js` verifies unauthenticated requests are blocked by `verifyToken` before reaching `GET /api/bookings`.
- `tests/bookingsControllerReadiness.test.js` verifies `getAllBookings` applies the documented `status`, `user_id`, `date_from`, and `date_to` filters plus pagination metadata.
- `tests/bookingsControllerReadiness.test.js` verifies invalid `status`, pagination, `user_id`, and date-range inputs are rejected before querying the database.
- `tests/openApiMountedRoutesContract.test.js` verifies `/api/bookings` remains present in the public OpenAPI inventory.

#### Live verification evidence
- Fact: parent-session live check against `https://api.infinite-track.tech/api/bookings?page=1&limit=5` returned `401` with body `{"message":"No token provided"}`.
- Fact: unauthenticated live access is blocked for `GET /api/bookings`.
- Fact: authenticated live verification was not completed from this session because no valid live token could be obtained from available local credential sources without guessing.
- Fact: one attempted login using credentials available in the current workspace was rejected at the validation layer with message `Password harus kombinasi huruf dan angka tanpa spasi`.

#### Status
- Repository evidence present and current OpenAPI/runtime filter alignment is confirmed; live evidence confirms unauthenticated access is blocked, but authenticated read behavior remains unverified.

#### Blocking notes
- Authenticated read-only live verification remains incomplete for final readiness evidence.

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
- Fact: parent-session live check against `https://api.infinite-track.tech/api/bookings/history?page=1&limit=5` returned `401` with body `{"message":"No token provided"}`.
- Fact: unauthenticated live access is blocked for `GET /api/bookings/history`.
- Fact: authenticated live verification was not completed from this session because no valid live token could be obtained from available local credential sources without guessing.
- Fact: one attempted login using credentials available in the current workspace was rejected at the validation layer with message `Password harus kombinasi huruf dan angka tanpa spasi`.

#### Status
- Repository evidence present and unauthenticated live blocking verified; authenticated read behavior remains unverified.

#### Blocking notes
- Authenticated read-only live verification remains incomplete for final readiness evidence.

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
- `deleteBooking` deletes only the booking record inside the transaction and does not destroy any related `Location` record.

#### Automated verification evidence
- `tests/bookingsReadinessContract.test.js` verifies authenticated non-admin users are blocked from `DELETE /api/bookings/{id}` with `403`.
- `tests/bookingsReadinessContract.test.js` verifies unauthenticated requests are blocked by `verifyToken` before reaching `DELETE /api/bookings/{id}`.
- `tests/bookingsControllerReadiness.test.js` verifies `deleteBooking` deletes only the booking record without deleting a shared `Location`.
- `tests/openApiMountedRoutesContract.test.js` verifies `/api/bookings/{id}` remains present in the public OpenAPI inventory.

#### Live verification evidence
- Fact: live mutation verification was not performed for `DELETE /api/bookings/{id}` because mutating staging actions are disallowed under the current audit constraint.

#### Status
- Repository evidence present and current delete logic no longer carries the earlier shared-location deletion risk; live mutation verification still required for readiness.

#### Blocking notes
- Mutation readiness remains unproven until a safe live `DELETE /api/bookings/{id}` verification path exists.

## Automated verification evidence
- `tests/bookingsReadinessContract.test.js` verifies route/auth boundaries and exported validator contract shape.
- `tests/bookingsControllerReadiness.test.js` verifies the current controller-level filter, validation, pagination, and delete-safety behavior that previously appeared stale in this audit.
- `tests/openApiMountedRoutesContract.test.js` verifies the bookings paths remain present in the public OpenAPI inventory.

## Task 5 endpoint status posture
- `POST /api/bookings`: repository evidence present, but live mutation verification remains not performed because mutating staging actions are disallowed under the current constraint.
- `PATCH /api/bookings/{id}`: repository evidence present, but live mutation verification remains not performed because mutating staging actions are disallowed under the current constraint.
- `GET /api/bookings`: repository evidence present, OpenAPI/runtime filter alignment is confirmed, and unauthenticated live access is blocked with `401`; authenticated live read behavior remains unverified because no valid live token could be obtained without guessing.
- `GET /api/bookings/history`: repository evidence present and unauthenticated live access is blocked with `401`; authenticated live read behavior remains unverified because no valid live token could be obtained without guessing.
- `DELETE /api/bookings/{id}`: repository evidence present, current delete behavior no longer removes `Location` records, and live mutation verification remains not performed because mutating staging actions are disallowed under the current constraint.

## Blocking gap list
### Contract gaps
- None currently evidenced in repository state.
### Logic gaps
- None currently evidenced in repository state.
### Automated verification gaps
- None blocking from repository-side coverage for the audited contract and controller behaviors.
### Live verification gaps
- Authenticated live verification for `GET /api/bookings` remains incomplete because no valid live token could be obtained from available local credential sources without guessing.
- Authenticated live verification for `GET /api/bookings/history` remains incomplete because no valid live token could be obtained from available local credential sources without guessing.
- Live mutation verification for `POST /api/bookings`, `PATCH /api/bookings/{id}`, and `DELETE /api/bookings/{id}` remains incomplete because mutating staging actions are disallowed under the current audit constraint.

## Live verification evidence summary (Task 5)
- Fact: `GET https://api.infinite-track.tech/api/bookings?page=1&limit=5` without a token returned `401` with body `{"message":"No token provided"}`.
- Fact: `GET https://api.infinite-track.tech/api/bookings/history?page=1&limit=5` without a token returned `401` with body `{"message":"No token provided"}`.
- Fact: unauthenticated live access is blocked for both read endpoints.
- Fact: authenticated live `GET` verification remains incomplete from this session because no valid live token could be obtained from available local credential sources without guessing.
- Fact: one attempted login using available workspace credentials was rejected at validation with `Password harus kombinasi huruf dan angka tanpa spasi`.
- Fact: `POST`/`PATCH`/`DELETE` remain not verified live because mutation evidence is disallowed under the current constraint.
- Assumption: the live host checked by the parent session, `https://api.infinite-track.tech`, is the intended environment for this audit's Task 5 live evidence.
- Needs Verification: authenticated `GET` behavior and all mutation endpoint live behavior still need approved credentials and/or an approved safe mutation path.

## Final readiness decision
- Decision: `NOT READY`
- Reasoning:
  - Task 4 repository evidence is captured for runtime routes, OpenAPI documentation, validators, controllers, and automated contract tests.
  - Current repository evidence closes the earlier `GET /api/bookings` filter-alignment concern and the earlier `DELETE /api/bookings/{id}` shared-location deletion concern.
  - Task 5 live verification confirms unauthenticated live access is blocked for both read endpoints, but authenticated live read behavior remains unverified because no valid live token could be obtained without guessing.
  - Task 5 live mutation verification remains intentionally not performed because mutating staging actions are disallowed under the current constraint.
  - Under this audit standard, missing authenticated live read evidence plus missing live mutation evidence is sufficient to keep the bookings surface out of `READY` status.

## Fix queue
1. Provide an approved valid live token or credential source for authenticated `GET /api/bookings` and `GET /api/bookings/history` verification.
2. Provide an approved safe live mutation verification path for `POST /api/bookings`, `PATCH /api/bookings/{id}`, and `DELETE /api/bookings/{id}`.
3. Re-run the final bookings readiness assessment once the missing live evidence is available.
