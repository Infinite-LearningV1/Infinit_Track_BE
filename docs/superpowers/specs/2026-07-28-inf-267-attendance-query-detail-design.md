# INF-267 Management Attendance Query and Detail Design

**Date:** 2026-07-28  
**Issue:** INF-267  
**Repository:** `Infinite-LearningV1/Infinit_Track_BE`  
**Base branch:** `develop`

## Purpose

Turn Management Attendance into a truthful server-driven audit surface. The
backend will own search, combined filters, stable sorting, pagination, and a
separate record-detail contract. This work does not change attendance
mutations, scheduled jobs, analytics, reporting, or permanent-delete
semantics.

## Scope

This change covers:

- validated `GET /api/attendance` query parameters;
- server-driven search, filters, sorting, and pagination;
- a slim canonical attendance list projection;
- `GET /api/attendance/:id` for full audit detail;
- Admin and Management authorization for list and detail;
- deterministic validation and not-found responses;
- OpenAPI and API contract inventory updates;
- focused route, validation, query, mapper, service, and controller tests.

The following remain out of scope:

- check-in, checkout, and attendance final-state rules;
- scheduled jobs;
- dashboard KPIs, analytics, reports, or exports;
- soft delete, void, restore, delete reason, or audit trail;
- Web FE implementation;
- broad Attendance Core modular migration.

## Architecture

Use a bounded read module while leaving the existing route mount and mutation
controllers in place:

```text
GET /api/attendance
  -> verifyToken
  -> roleGuard(Admin, Management)
  -> attendance list query validation
  -> legacy attendance HTTP controller
  -> attendance read service
  -> attendance query builder
  -> Sequelize
  -> attendance mapper
  -> HTTP response

GET /api/attendance/:id
  -> verifyToken
  -> roleGuard(Admin, Management)
  -> attendance ID validation
  -> legacy attendance HTTP controller
  -> attendance read service
  -> Sequelize
  -> attendance mapper
  -> HTTP response
```

New attendance-owned files live under `src/modules/attendance/`:

- `attendance.validation.js` owns transport validation and normalized query
  values;
- `attendance.query.js` owns Sequelize includes, selected attributes, filters,
  search, pagination, and order allowlists;
- `attendance.mapper.js` owns stable list and detail response projections;
- `attendanceRead.service.js` owns the list and detail use cases and has no
  Express dependency.

`src/controllers/attendance.controller.js` retains the public controller
exports so existing imports remain stable. `getAllAttendances` and the new
`getAttendanceDetail` only read validated input, call the service, and choose
the HTTP envelope/status.

This is intentionally smaller than a full Attendance Core migration. It
introduces feature-owned read boundaries without moving check-in, checkout,
jobs, or delete behavior.

## List Request Contract

```http
GET /api/attendance
  ?page=1
  &limit=20
  &search=andi
  &from=2026-07-01
  &to=2026-07-31
  &mode=wfh
  &status=late
  &checkout_state=completed
  &sortBy=attendance_date
  &sortOrder=DESC
```

Supported parameters:

| Parameter | Contract |
| --- | --- |
| `page` | Positive base-10 integer; default `1` |
| `limit` | Positive base-10 integer; default `10`; maximum `100` |
| `search` | Trimmed string; empty input becomes no search |
| `from` | Optional strict calendar date `YYYY-MM-DD` |
| `to` | Optional strict calendar date `YYYY-MM-DD` |
| `mode` | Optional `wfo`, `wfh`, or `wfa` |
| `status` | Optional `ontime`, `late`, `alpha`, or `early` |
| `checkout_state` | Optional `completed` or `open` |
| `sortBy` | Optional public sort key from the allowlist below |
| `sortOrder` | Optional `ASC` or `DESC`; normalized to uppercase |

Unknown query keys are rejected. Every supported value must be scalar:
arrays, nested objects, and other non-string query shapes return validation
errors instead of reaching the controller. When both dates are supplied,
`from` must be on or before `to`.

Invalid values return the repository validation envelope:

```json
{
  "success": false,
  "code": "E_VALIDATION",
  "message": "first deterministic validation message",
  "errors": []
}
```

## Search and Filter Semantics

Search matches these User fields:

- `full_name`;
- `nip_nim`;
- `email`.

Search is case-insensitive according to the configured MySQL collation. Before
building the `LIKE` pattern, backslash, percent, and underscore are escaped so
input such as `100%`, `A_B`, or `C\D` is treated literally.

Exact filters use canonical public keys:

- mode maps `wfo`, `wfh`, and `wfa` to attendance category IDs `1`, `2`, and
  `3`;
- status maps `ontime`, `late`, `alpha`, and `early` to attendance status IDs
  `1`, `2`, `3`, and `4`;
- `completed` applies `time_out IS NOT NULL`;
- `open` applies `time_out IS NULL`;
- date boundaries apply to `attendance_date`, inclusively.

All search and filter conditions are combined in one Sequelize
`where/include` graph before the single `findAndCountAll()` call. Rows and
total count therefore use identical conditions.

## Sorting

Public keys never pass through to Sequelize directly:

| Public key | Sequelize target |
| --- | --- |
| `attendance_date` | `Attendance.attendance_date` |
| `time_in` | `Attendance.time_in` |
| `time_out` | `Attendance.time_out` |
| `full_name` | joined `user.full_name` |
| `status` | joined `status.attendance_status_name` |
| `created_at` | `Attendance.created_at` |

Default order:

```text
attendance_date DESC
time_in DESC
id_attendance DESC
```

An explicit public sort uses its requested direction followed by
`id_attendance DESC`. The final attendance ID order is a deterministic
tie-breaker and is not exposed as an arbitrary public column selector.

## Pagination Response

The existing attendance pagination envelope is retained:

```json
{
  "success": true,
  "message": "Data absensi berhasil diambil",
  "data": [],
  "pagination": {
    "current_page": 1,
    "total_pages": 5,
    "total_records": 100,
    "records_per_page": 20,
    "has_next_page": true,
    "has_prev_page": false
  }
}
```

An out-of-range page returns `200`, an empty `data` array, the requested
`current_page`, and metadata calculated from the real total. A zero-row result
has `total_pages: 0`, `has_next_page: false`, and `has_prev_page: false`. For a
non-zero total, `has_prev_page` is true when the requested page is greater than
`1`.

## List Projection

Each list row is intentionally limited to audit-table fields:

```json
{
  "id_attendance": 42,
  "attendance_date": "2026-07-28",
  "user": {
    "id": 7,
    "full_name": "Andi Saputra",
    "nip_nim": "EMP-007",
    "role": "User"
  },
  "time_in": "08:02",
  "time_out": "17:05",
  "work_duration": "09:03",
  "mode": {
    "key": "wfo",
    "label": "WFO"
  },
  "status": {
    "key": "ontime",
    "label": "On Time"
  },
  "location": {
    "available": true,
    "id": 1,
    "description": "Palu Office"
  }
}
```

The list does not expose email, notes, booking ID, raw coordinates, or radius.
Those fields belong to the detail endpoint. `location.available` is false and
the other compact location fields are null when the attendance row has no
linked location.

This canonical projection replaces the ambiguous `information` field and
separates list data from detail evidence. OpenAPI and the API contract
inventory will record this migration for the INF-269 Web FE consumer.

## Detail Contract

```http
GET /api/attendance/:id
```

The path ID must be a positive integer. Admin and Management use the same
authorization boundary as list and delete. A plain User receives `403`.

Success response:

```json
{
  "success": true,
  "message": "Detail absensi berhasil diambil",
  "data": {
    "id_attendance": 42,
    "attendance_date": "2026-07-28",
    "time_in": "08:02",
    "time_out": "17:05",
    "work_duration": "09:03",
    "mode": {
      "key": "wfo",
      "label": "WFO"
    },
    "status": {
      "key": "ontime",
      "label": "On Time"
    },
    "notes": "",
    "booking_id": null,
    "user": {
      "id": 7,
      "full_name": "Andi Saputra",
      "nip_nim": "EMP-007",
      "email": "andi@example.com",
      "role": "User"
    },
    "location": {
      "id": 1,
      "description": "Palu Office",
      "latitude": -0.900291,
      "longitude": 119.877998,
      "radius": 100
    }
  }
}
```

The detail query joins only the attendance row's `location_id`. If that
association is absent, `location` is `null`; it must not look up or substitute
the user's WFH profile location.

A missing record returns:

```json
{
  "success": false,
  "message": "Data absensi tidak ditemukan."
}
```

with HTTP `404`.

## Error Handling

- route validation owns malformed query and path input;
- service/query failures are forwarded through `next(error)` to the canonical
  error middleware;
- no raw Sequelize error is formatted inside the module;
- list and detail controllers use `try/catch` and do not return a new error
  shape;
- existing delete error behavior and hard-delete implementation are unchanged.

## Route Ordering

Static attendance routes remain registered before `GET /:id`. The new dynamic
GET route is added after all static GET paths so values such as
`today-locations`, `history`, and `smart-config` cannot be interpreted as an
attendance ID. HTTP method separation means the existing `DELETE /:id`
continues unchanged.

## Test Strategy

TDD will be applied in small red-green-refactor cycles:

1. route validation rejects invalid numbers, impossible dates, reversed
   ranges, invalid enums, unsupported sort keys, unknown keys, arrays, and
   objects with deterministic `400 E_VALIDATION`;
2. validation supplies normalized defaults and trimmed search to the
   controller;
3. query tests pin escaped search patterns, date/mode/status/checkout filters,
   combined `where/include` behavior, pagination, and count consistency;
4. sort tests pin every allowlisted mapping, default order, and the stable
   attendance-ID tie-breaker;
5. mapper tests pin slim list rows, canonical mode/status values, compact
   location handling, and detail-only fields;
6. service/controller tests cover populated, empty, out-of-range, detail
   success, detail missing, and forwarded failures;
7. route tests cover Admin, Management, User, and unauthenticated access;
8. OpenAPI contract tests pin request parameters, response keys, and the new
   detail operation.

Final local gates:

```text
npm run lint
npm test -- --runInBand
```

Runtime/Postman evidence requires a running backend with a compatible database
and Admin/Management authentication. If that environment is not available
locally, the PR will mark runtime evidence as `Needs Verification` rather than
claiming it.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Query contract drift with Web FE | Canonical keys and response examples are pinned in OpenAPI and tests |
| Incorrect totals with joins | One `findAndCountAll` graph with `distinct: true` and identical filters |
| SQL wildcard overmatching | Escape backslash, percent, and underscore before `LIKE` |
| Unstable pagination | Explicit allowlist plus `id_attendance DESC` tie-breaker |
| Sensitive/detail data leaking into list | Mapper allowlists the slim list projection |
| Fabricated WFH evidence | Detail uses only the attendance-linked location |
| Attendance final-state regression | No mutation, scheduler, status-classification, or delete changes |

## Documentation Decision

This work changes an API-significant attendance contract, so OpenAPI and the
API contract inventory must be updated. A new ADR is not required because the
bounded module follows the already-approved Modular MVC decision in INF-252
and does not introduce a new architectural direction.
