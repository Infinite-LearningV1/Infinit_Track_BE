# INF-274 Follow-up — Management Booking Pagination Envelope Design

**Date:** 2026-08-10  
**Repository:** `Infinite-LearningV1/Infinit_Track_BE`  
**Base:** `origin/develop` at `cfdaed1`  
**Branch:** `fix/inf-274-booking-pagination-envelope`

## Purpose

Standardize the Management Booking pagination response with the canonical Management Attendance vocabulary without breaking existing consumers of the INF-274 response.

`GET /api/bookings` already performs server-side pagination with validated `page` and `limit`, `findAndCountAll()`, and `(page - 1) * limit` offset. This follow-up changes only the pagination response contract and its documentation/tests.

## Current Contract

Management Booking currently returns:

```json
{
  "current_page": 2,
  "total_pages": 3,
  "total_items": 11,
  "items_per_page": 5
}
```
Management Attendance already uses the preferred vocabulary:

```json
{
  "current_page": 2,
  "total_pages": 3,
  "total_records": 11,
  "records_per_page": 5,
  "has_next_page": true,
  "has_prev_page": true
}
```

The Web FE currently compensates by normalizing `total_items` / `items_per_page` and deriving navigation booleans. The Backend should publish the canonical fields directly while preserving the existing aliases during migration.

## Design Decision

The Management Booking response becomes additive:

```json
{
  "current_page": 2,
  "total_pages": 3,
  "total_records": 11,
  "records_per_page": 5,
  "has_next_page": true,
  "has_prev_page": true,
  "total_items": 11,
  "items_per_page": 5
}
```

Canonical fields are:

- `current_page`
- `total_pages`
- `total_records`
- `records_per_page`
- `has_next_page`
- `has_prev_page`

Compatibility aliases are retained temporarily:

- `total_items` = `total_records`
- `items_per_page` = `records_per_page`

The aliases must be documented as deprecated. They are not removed in this change.

## Pagination Semantics

For non-empty results:

- `total_pages = Math.ceil(total_records / records_per_page)`
- `has_next_page = current_page < total_pages`
- `has_prev_page = total_pages > 0 && current_page > 1`
For an empty result set:

```json
{
  "current_page": 1,
  "total_pages": 0,
  "total_records": 0,
  "records_per_page": 10,
  "has_next_page": false,
  "has_prev_page": false,
  "total_items": 0,
  "items_per_page": 10
}
```

This issue does **not** introduce page clamping. Existing query semantics remain unchanged when a caller requests a page beyond `total_pages`.

## Architecture

The existing read path remains:

```text
Route validation
→ getAllBookings controller
→ listManagementBookings read service
→ booking query builder
→ Booking.findAndCountAll
→ booking mapper + pagination envelope
```
Only the read-service pagination projection changes. No controller business logic, query construction, database model, migration, WFA scoring, approval/rejection behavior, or authentication behavior changes.

## OpenAPI Contract

Do not broaden or mutate the shared `Pagination` schema because it is reused by unrelated endpoints with historical contracts.

Add the booking-specific schema `BookingManagementPagination` and point `GET /api/bookings` to it. The schema must require all eight runtime fields. `total_items` and `items_per_page` remain required during the compatibility window but are marked deprecated, while the six canonical fields are the preferred consumer contract.

The endpoint's `page` / `limit` request parameters remain unchanged:

- `page`: integer, minimum `1`, default `1`
- `limit`: integer, minimum `1`, maximum `100`, default `10`

## Error Handling

No new failure class is introduced. Existing query validation and canonical error middleware remain authoritative. Pagination projection uses values already validated before controller execution.

## Testing Strategy

TDD must lock the response before production changes:

1. Update `bookingManagementReadService.test.js` to expect canonical fields and compatibility aliases for non-empty and empty datasets.
2. Update `bookingManagementController.test.js` to prove the richer pagination object passes through unchanged.
3. Extend `bookingManagementOpenApiContract.test.js` to require `BookingManagementPagination`, all eight required runtime fields, and deprecated compatibility aliases.
4. Run focused Management Booking tests.
5. Run `npm run lint` and the full non-integration Jest suite before completion.

Baseline before this change is `155/155` suites and `1477/1477` tests passing.

## Acceptance Criteria

- `GET /api/bookings` still paginates server-side using the existing `page` and `limit` query contract.
- Response pagination contains all six canonical fields.
- `total_items` and `items_per_page` remain present and equal their canonical counterparts.
- `has_next_page` and `has_prev_page` are Backend-authored, not inferred by the API consumer.
- Empty pagination returns `total_pages: 0` and both navigation booleans `false`.
- OpenAPI publishes a Management Booking-specific pagination schema and marks compatibility aliases deprecated.
- Existing search, filters, ordering, projection, approval/rejection, and authorization behavior remain unchanged.
- No database migration is added.
- Focused tests, lint, full non-integration tests, and `git diff --check` pass.

## Non-Goals

- Removing compatibility aliases.
- Standardizing every Backend endpoint in this PR.
- Changing Web FE pagination state in this Backend PR.
- Adding cursor pagination.
- Page clamping or pagination policy redesign.
- Changing sorting, search, WFA scoring, or booking lifecycle semantics.
