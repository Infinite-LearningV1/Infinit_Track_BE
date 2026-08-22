# Management Booking Pagination Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize `GET /api/bookings` pagination metadata with canonical Management Attendance field names while preserving INF-274 compatibility aliases.

**Architecture:** Keep the existing route → controller → `listManagementBookings` read-service path unchanged. Modify only the booking read-service pagination projection and publish a booking-specific OpenAPI pagination schema; controller remains a pass-through adapter.

**Tech Stack:** Node.js ESM, Express, Sequelize, Jest 29, YAML OpenAPI 3.x, ESLint.

## Global Constraints

- Base contract is `origin/develop` after PR #136 (`cfdaed1`).
- Preserve server-side `page` / `limit` validation and query semantics.
- Preserve `total_items` and `items_per_page` as deprecated aliases.
- Add `total_records`, `records_per_page`, `has_next_page`, and `has_prev_page` as canonical fields.
- Do not change search, filters, ordering, approval/rejection, scoring, auth, models, or migrations.
- Do not mutate the shared OpenAPI `Pagination` schema.

---
### Task 1: Lock and implement the runtime pagination envelope

**Files:**
- Modify: `tests/bookingManagementReadService.test.js`
- Modify: `tests/bookingManagementController.test.js`
- Modify: `src/modules/booking/bookingManagementRead.service.js`

**Interfaces:**
- Consumes: validated `{ page?: number, limit?: number, ...filters }` query.
- Produces: `{ bookings, pagination }` where `pagination` contains eight fields: six canonical fields plus two compatibility aliases.

- [ ] **Step 1: Write failing read-service tests**

For `count: 11`, `page: 2`, `limit: 5`, expect:
```js
pagination: {
  current_page: 2,
  total_pages: 3,
  total_records: 11,
  records_per_page: 5,
  has_next_page: true,
  has_prev_page: true,
  total_items: 11,
  items_per_page: 5
}
```

For `count: 0`, default page/limit, expect `total_pages: 0`, both navigation booleans `false`, and both alias pairs equal.
- [ ] **Step 2: Run the focused read-service test and verify RED**

Run:
```powershell
npm test -- --runInBand tests/bookingManagementReadService.test.js
```
Expected: FAIL because canonical fields and navigation booleans are absent.

- [ ] **Step 3: Implement the minimal read-service projection**

Compute `totalPages` once, then return:
```js
pagination: {
  current_page: page,
  total_pages: totalPages,
  total_records: count,
  records_per_page: limit,
  has_next_page: page < totalPages,
  has_prev_page: totalPages > 0 && page > 1,
  total_items: count,
  items_per_page: limit
}
```

- [ ] **Step 4: Update the controller contract fixture**

Change only the mocked/expected pagination object in `bookingManagementController.test.js`; controller implementation should remain unchanged.

- [ ] **Step 5: Run focused runtime tests and verify GREEN**

Run:
```powershell
npm test -- --runInBand tests/bookingManagementReadService.test.js tests/bookingManagementController.test.js
```
Expected: both suites PASS.
- [ ] **Step 6: Commit runtime contract**

```powershell
git add src/modules/booking/bookingManagementRead.service.js tests/bookingManagementReadService.test.js tests/bookingManagementController.test.js
git commit -m "fix(INF-274): standardize booking pagination envelope"
```

### Task 2: Publish the booking-specific OpenAPI pagination schema

**Files:**
- Modify: `docs/openapi.yaml`
- Modify: `tests/bookingManagementOpenApiContract.test.js`

**Interfaces:**
- Consumes: runtime pagination object from Task 1.
- Produces: `#/components/schemas/BookingManagementPagination`, referenced by `GET /api/bookings`.

- [ ] **Step 1: Write failing OpenAPI contract assertions**

Assert that the 200 response pagination `$ref` is:
```js
'#/components/schemas/BookingManagementPagination'
```

Assert the schema requires:
```js
[
  'current_page', 'total_pages', 'total_records', 'records_per_page',
  'has_next_page', 'has_prev_page', 'total_items', 'items_per_page'
]
```
and that `total_items.deprecated === true` and `items_per_page.deprecated === true`.
- [ ] **Step 2: Run the focused OpenAPI test and verify RED**

Run:
```powershell
npm test -- --runInBand tests/bookingManagementOpenApiContract.test.js
```
Expected: FAIL because `/api/bookings` still references shared `Pagination` and the booking-specific schema does not exist.

- [ ] **Step 3: Add `BookingManagementPagination` to OpenAPI**

Define an object schema with all eight required fields. Use integer types for counts/pages, boolean types for navigation flags, and mark only `total_items` and `items_per_page` as `deprecated: true` with descriptions pointing consumers to their canonical replacements.

- [ ] **Step 4: Repoint `GET /api/bookings` pagination reference**

Replace only:
```yaml
pagination:
  $ref: '#/components/schemas/Pagination'
```
inside `GET /api/bookings` with:
```yaml
pagination:
  $ref: '#/components/schemas/BookingManagementPagination'
```
Do not change other endpoints using the shared schema.

- [ ] **Step 5: Run OpenAPI and runtime drift tests**

Run:
```powershell
npm test -- --runInBand tests/bookingManagementOpenApiContract.test.js tests/openApiRuntimeDriftContract.test.js
```
Expected: both suites PASS.
- [ ] **Step 6: Commit OpenAPI contract**

```powershell
git add docs/openapi.yaml tests/bookingManagementOpenApiContract.test.js
git commit -m "docs(INF-274): publish booking pagination contract"
```

### Task 3: Final regression, branch audit, and PR

**Files:**
- Verify all files changed by Tasks 1-2 plus spec/plan docs.

**Interfaces:**
- Produces: a clean branch ready for review against `refs/remotes/origin/develop`.

- [ ] **Step 1: Run focused Management Booking regression**

```powershell
npm test -- --runInBand tests/bookingManagementReadService.test.js tests/bookingManagementController.test.js tests/bookingManagementOpenApiContract.test.js tests/bookingManagementQueryValidation.test.js tests/bookingManagementQuery.test.js
```
Expected: all selected suites PASS.

- [ ] **Step 2: Run lint**

```powershell
npm run lint
```
Expected: exit code `0`.

- [ ] **Step 3: Run the full non-integration suite**

```powershell
npm test -- --runInBand
```
Expected: no failures; compare suite/test counts with the baseline `155/155` and `1477/1477`, allowing the total test count to increase only from newly added assertions/tests.
- [ ] **Step 4: Verify Git hygiene and scope**

```powershell
git diff --check refs/remotes/origin/develop...HEAD
git status --short
git diff --stat refs/remotes/origin/develop...HEAD
git rev-list --left-right --count refs/remotes/origin/develop...HEAD
```
Expected: no whitespace errors, clean worktree, bounded diff, branch ahead of and not behind `origin/develop`.

- [ ] **Step 5: Push the branch**

```powershell
git push -u origin fix/inf-274-booking-pagination-envelope
```
Expected: remote branch created successfully.

- [ ] **Step 6: Create the PR targeting `develop`**

Title:
```text
fix(INF-274): standardize management booking pagination envelope
```

PR body must state: canonical fields added; legacy aliases retained/deprecated; no DB migration; search/filter/ordering/booking lifecycle unchanged; focused/lint/full-suite evidence; runtime/Postman not required because this is a deterministic read-response projection change.

- [ ] **Step 7: Verify the created PR**

Confirm base=`develop`, head=`fix/inf-274-booking-pagination-envelope`, changed files match the planned scope, and CI/checks have started.
