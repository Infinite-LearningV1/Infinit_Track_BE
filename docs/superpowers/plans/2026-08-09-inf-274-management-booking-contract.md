# INF-274 Management Booking Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `GET /api/bookings` with truthful processor identity and server-side applicant search while preserving existing WFA booking semantics and response compatibility.

**Architecture:** Extract only the Admin/Management booking-list read path into a bounded `src/modules/booking/` module, following the existing Management Attendance read pattern. Keep booking creation, status mutation, employee history, delete, scheduler behavior, and DB schema unchanged.

**Tech Stack:** Node.js ESM, Express 4, express-validator, Sequelize 6, MySQL, Jest 29, OpenAPI YAML.

## Global Constraints

- Base branch is `origin/develop` at `0c8e0d09829b81dcbe275da36c6375a08c8353c9`.
- Work only on `feature/inf-274-management-booking-contract` in the isolated worktree.
- No database migration.
- Preserve `Pending → Approved → Rejected → created_at DESC`, adding only `booking_id DESC` as deterministic tie-breaker.
- `processed_by` is canonical presentation identity; raw `approved_by` remains for compatibility.
- Automated rejection may have `processed_at != null` with `processed_by = null`; never fabricate a System actor.
- Search only `User.full_name` and `User.nip_nim`.
- Search is trimmed and escapes `\\`, `%`, and `_` before building the SQL LIKE pattern.
- `suitability_score` and `suitability_label` remain nullable; numeric zero remains valid.
- Nested `request_reason.other_text` and `rejection_reason.note` remain canonical.
- `sortBy` and `sortOrder` are temporary deprecated no-op compatibility inputs; do not implement sorting from them.
- TDD is mandatory: every production behavior starts with a failing focused test.

---
## File Map

**Create**
- `src/modules/booking/bookingManagement.validation.js` — validates and normalizes management-list query input.
- `src/modules/booking/bookingManagement.query.js` — builds Sequelize filters, search, includes, ordering, limit, and offset.
- `src/modules/booking/bookingManagement.mapper.js` — maps Sequelize rows to the stable Management Booking projection.
- `src/modules/booking/bookingManagementRead.service.js` — executes the paginated read use case.
- `tests/bookingManagementQueryValidation.test.js` — query middleware contract.
- `tests/bookingManagementQuery.test.js` — Sequelize query/search/order contract.
- `tests/bookingManagementMapper.test.js` — projection and nullable-evidence contract.
- `tests/bookingManagementReadService.test.js` — service pagination/mapper contract.

**Modify**
- `src/models/index.js` — add read association from `Booking.approved_by` to processor User.
- `src/controllers/booking.controller.js` — make `getAllBookings` a thin adapter to the read service.
- `src/routes/booking.routes.js` — add management-list validation before `getAllBookings`.
- `tests/bookingsReadinessContract.test.js` — pin route middleware order.
- `tests/bookingsControllerReadiness.test.js` — replace implementation-detail list assertions with thin-delegation contract where needed.
- `tests/bookingWfaProjectionContract.test.js` — keep unchanged employee projections protected and migrate management projection assertions to module tests.
- `docs/openapi.yaml` — document `search`, compatibility no-op sort params, `processed_by`, nullable scoring, and management row schema.
- OpenAPI contract tests as identified by the existing suite.

---
### Task 1: Lock management-list query validation

**Files:**
- Create: `tests/bookingManagementQueryValidation.test.js`
- Create: `src/modules/booking/bookingManagement.validation.js`
- Modify: `src/routes/booking.routes.js`
- Modify: `tests/bookingsReadinessContract.test.js`

**Produces:** `validateBookingManagementListQuery`, an express-validator chain that normalizes `page`/`limit`, trims `search`, validates status/user/date fields, rejects non-scalar and unknown canonical keys, and permits only deprecated `sortBy`/`sortOrder` no-ops.

- [ ] Write focused middleware tests for defaults, valid combined query, empty/malformed pagination, invalid status/user/date range, trimmed search, non-scalar values, unsupported keys, and compatibility sort keys.
- [ ] Run `npm test -- tests/bookingManagementQueryValidation.test.js --runInBand` and verify RED because the validation module does not exist.
- [ ] Implement the minimal validation module using the same strict date and scalar-query conventions as Management Attendance.
- [ ] Run the focused test and verify GREEN.
- [ ] Add `validateBookingManagementListQuery, validate` to `GET /api/bookings` after `roleGuard` and before `getAllBookings`.
- [ ] Update the route contract test and verify the route-focused tests pass.
- [ ] Commit: `test(INF-274): lock management booking query contract`.

### Task 2: Build deterministic search/filter query

**Files:**
- Create: `tests/bookingManagementQuery.test.js`
- Create: `src/modules/booking/bookingManagement.query.js`
- Modify: `src/models/index.js`

**Produces:** `buildBookingManagementListQuery(query)` and `escapeBookingSearchLike(value)`.

- [ ] Write RED tests proving search targets only applicant `full_name`/`nip_nim`, escapes `\\%_`, sets applicant include `required: true` only for active search, composes existing booking filters, includes optional processor + role, and preserves approval-first deterministic ordering.
- [ ] Run the focused query test and verify expected missing-module failures.
- [ ] Add `Booking.belongsTo(User, { foreignKey: 'approved_by', targetKey: 'id_users', as: 'processor' })` without schema changes.
- [ ] Implement the minimal query builder with explicit attributes/includes, `distinct: true`, `limit`, and `offset`.
- [ ] Run the query tests and verify GREEN.
- [ ] Commit: `feat(INF-274): add management booking query builder`.

---
### Task 3: Stabilize management booking projection

**Files:**
- Create: `tests/bookingManagementMapper.test.js`
- Create: `src/modules/booking/bookingManagement.mapper.js`

**Produces:** `mapBookingManagementRow(row)`.

- [ ] Write RED mapper tests for manual approval/rejection processor identity, pending null processor, automated processed/null processor, nested reason objects, radius snapshot fallback, nullable score/label, and numeric zero score.
- [ ] Run `npm test -- tests/bookingManagementMapper.test.js --runInBand` and verify RED.
- [ ] Implement the minimal pure mapper with explicit number/null conversion and no fabricated values.
- [ ] Run focused mapper tests and verify GREEN.
- [ ] Commit: `feat(INF-274): add management booking projection`.

### Task 4: Extract management read service and thin controller

**Files:**
- Create: `tests/bookingManagementReadService.test.js`
- Create: `src/modules/booking/bookingManagementRead.service.js`
- Modify: `src/controllers/booking.controller.js`
- Modify: `tests/bookingsControllerReadiness.test.js`
- Modify: `tests/bookingWfaProjectionContract.test.js`

**Produces:** `listManagementBookings(query)` returning `{ bookings, pagination }` with the existing management-list pagination field names.

- [ ] Write RED service tests proving one `Booking.findAndCountAll()` query, mapped rows, total-pages calculation, and empty-result behavior.
- [ ] Run the focused service test and verify RED.
- [ ] Implement the service using the query builder and mapper.
- [ ] Run focused service tests and verify GREEN.
- [ ] Write/update controller tests proving `getAllBookings` delegates normalized `req.query`, preserves `{ success, data: { bookings, pagination }, message }`, and forwards failures with `next(error)`.
- [ ] Replace only the legacy `getAllBookings` body with the thin service adapter; do not touch create/update/history/delete semantics.
- [ ] Run controller readiness and WFA projection regression tests.
- [ ] Commit: `refactor(INF-274): extract management booking read path`.

---
### Task 5: Align OpenAPI and public contract tests

**Files:**
- Modify: `docs/openapi.yaml`
- Modify/Create focused OpenAPI contract test(s) under `tests/` based on existing booking/OpenAPI conventions.

- [ ] Write or extend a RED OpenAPI contract test that requires `search`, documents deprecated no-op `sortBy`/`sortOrder`, and requires nullable `processed_by` with `id`, `full_name`, and `role`.
- [ ] Run the focused OpenAPI test and verify RED against the current spec.
- [ ] Update the booking-list OpenAPI operation and introduce/reuse a dedicated management booking list-item schema matching runtime projection.
- [ ] Document `suitability_score` and `suitability_label` as nullable and preserve nested WFA reason structures.
- [ ] Run focused OpenAPI tests and verify GREEN.
- [ ] Commit: `docs(INF-274): align management booking API contract`.

### Task 6: Regression and completion verification

**Files:** no new production behavior.

- [ ] Run focused booking suite: `npm test -- tests/bookingManagementQueryValidation.test.js tests/bookingManagementQuery.test.js tests/bookingManagementMapper.test.js tests/bookingManagementReadService.test.js tests/bookingsControllerReadiness.test.js tests/bookingWfaProjectionContract.test.js tests/bookingsReadinessContract.test.js --runInBand`.
- [ ] Run `npm run lint`.
- [ ] Run full `npm test -- --runInBand`.
- [ ] Run `git diff --check origin/develop...HEAD`.
- [ ] Inspect `git status --short` and `git diff --stat origin/develop...HEAD`; confirm no DB migration, scheduler, WFA scoring, or unrelated files changed.
- [ ] Record runtime/Postman evidence when an authenticated backend runtime is available; otherwise mark runtime evidence `Needs Verification` rather than inventing it.
- [ ] Commit any verification-only documentation correction if required.

## Expected Completion Evidence

- Focused query/mapper/service/controller tests pass.
- `npm run lint` exits 0.
- Full Jest suite passes with no new failures compared with baseline `148 suites / 1450 tests`.
- `git diff --check origin/develop...HEAD` exits 0.
- Management list returns `processed_by` from persisted processor evidence or `null`.
- Server-side `search` affects both rows and pagination count in the same Sequelize query.
- Existing raw `approved_by`, booking mutations, employee history, WFA scoring, and DB schema remain unchanged.
