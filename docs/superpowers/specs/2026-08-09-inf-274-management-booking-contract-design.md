# INF-274 Management Booking Contract Design

**Date:** 2026-08-09
**Issue:** INF-274
**Repository:** `Infinite-LearningV1/Infinit_Track_BE`
**Base branch:** `develop`
**Base commit:** `0c8e0d09829b81dcbe275da36c6375a08c8353c9`
**Working branch:** `feature/inf-274-management-booking-contract`

## Purpose

Extend the Admin/Management booking read contract so the Web FE can render Management Booking as a truthful approval/review queue.

The target product flow is:

```text
Pemohon → Jadwal WFA → Diajukan → Alasan → Lokasi → Kelayakan → Status → Review/Detail
```

This issue adds processor identity and real server-side search while preserving current WFA booking business rules, scoring semantics, transaction behavior, and database schema.

## Current verified baseline

The isolated worktree starts from `origin/develop` after INF-272. Fresh baseline verification passes:

```text
Test Suites: 148 passed, 148 total
Tests:       1450 passed, 1450 total
```
The relevant runtime is still concentrated in `src/controllers/booking.controller.js`, which is approximately 1000 lines and currently owns list validation, Sequelize query construction, projection, mutation flows, booking history, and delete behavior.

`GET /api/bookings` currently supports:

- `page`
- `limit`
- `status`
- `user_id`
- `date_from`
- `date_to`

The current list response already includes applicant identity, schedule date, location, notes, suitability, reason projections, `created_at`, `processed_at`, and raw `approved_by`.

INF-272 already changed booking scoring to canonical WFA facility scoring. `suitability_score` and `suitability_label` are nullable and numeric zero is a valid value that must be preserved.

## Product decisions already locked

Management Booking is an approval-first operational surface, not a second analytics dashboard.

The Web FE table will use:

```text
Pemohon | Jadwal WFA | Diajukan | Alasan | Lokasi | Kelayakan | Status | Aksi
```
Location coordinates and radius belong to the review/detail presentation, not the compact table. The current list contract may continue carrying them for compatibility; this issue does not introduce a separate booking-detail endpoint.

Approval and rejection remain existing booking mutations. This issue changes only the management read contract and the projection required to describe who processed a decision.

## Scope

This change covers:

- server-side search on applicant `full_name` and `nip_nim`;
- query validation for the management booking list;
- composition of search with existing status, user, date, and pagination filters;
- canonical `processed_by` projection resolved from the existing `approved_by` foreign key;
- preservation of nested request/rejection reason projections;
- preservation of nullable suitability semantics;
- bounded extraction of the management booking read path from the legacy controller;
- OpenAPI and contract-test updates.

Out of scope:

- booking creation policy changes;
- approval/rejection business-rule changes;
- WFA scoring changes beyond consuming INF-272 output;
- database migrations;
- arbitrary sorting or new `sortBy`/`sortOrder` behavior;
- `GET /api/bookings/:id`;
- redesigning booking history for the authenticated employee;
- Web FE implementation itself;
- soft delete, audit-log redesign, or mutation architecture rewrite.

## Architecture choice

Three implementation shapes were considered.

### Option A — extend `booking.controller.js` in place

This is the smallest diff, but it would add search validation, joined-user predicates, processor joins, and projection rules to an already large controller. It also makes isolated query/mapper testing harder.

### Option B — rewrite the Booking feature into a full new module

This would improve structure but would mix unrelated create/update/history/delete behavior into INF-274. The migration risk is not justified by the contract change.

### Option C — bounded management-read module — selected

Follow the already-landed Attendance read pattern and extract only the Admin/Management list path:

```text
GET /api/bookings
  → verifyToken
  → roleGuard(Admin, Management)
  → management booking query validation
  → legacy booking HTTP controller
  → booking management read service
  → query builder
  → Sequelize
  → mapper
  → existing HTTP envelope
```

This keeps mutations and employee history untouched while making the new read behavior independently testable.

## Proposed module boundaries

Create a focused read module under `src/modules/booking/`:

- `bookingManagement.validation.js` owns management-list transport validation and normalization;
- `bookingManagement.query.js` owns Sequelize filters, search, includes, ordering, pagination, and selected attributes;
- `bookingManagement.mapper.js` owns the stable management-list projection;
- `bookingManagementRead.service.js` owns the paginated management-list use case.

`src/controllers/booking.controller.js` keeps the public `getAllBookings` export for route compatibility, but that function becomes a thin adapter that reads validated query values, calls the read service, and returns the existing envelope.

The existing create, update-status, history, and delete controller flows stay where they are for this issue.

## Management list request contract

Target request:

```http
GET /api/bookings
  ?page=1
  &limit=20
  &status=pending
  &user_id=42
  &date_from=2026-08-01
  &date_to=2026-08-31
  &search=andi
```
Supported parameters:

| Parameter | Contract |
| --- | --- |
| `page` | Positive integer; default `1` |
| `limit` | Positive integer `1-100`; default `10` |
| `status` | Optional `pending`, `approved`, or `rejected` |
| `user_id` | Optional positive integer |
| `date_from` | Optional strict calendar date `YYYY-MM-DD` |
| `date_to` | Optional strict calendar date `YYYY-MM-DD`; must not precede `date_from` |
| `search` | Optional trimmed string searched against applicant name and NIP/NIM |

The canonical management-list keys are the seven parameters above. Array/object values are rejected for canonical parameters; each supported query parameter must be scalar.

Empty `search` after trimming behaves as no search. Empty or malformed pagination/date/filter values produce a deterministic validation response before Sequelize executes.

`sortBy` and `sortOrder` do not gain sorting semantics in this contract. Because the currently deployed Web FE still sends them, the validator temporarily permits these two names as deprecated compatibility-only no-ops. Other unknown query keys are rejected. The Web FE follow-up must stop sending both parameters; they can be removed from the compatibility allowlist after that consumer migration.

## Search semantics

Search applies only to the joined booking applicant:

- `User.full_name`;
- `User.nip_nim`.

It does not search email, position, notes, request-reason labels, location description, or status in INF-274.
Before building the `LIKE` pattern, backslash, percent, and underscore are escaped so user input is treated literally. Case-insensitivity follows the configured MySQL collation; the API does not introduce a second client-side search interpretation.

The applicant include becomes required when search is active so filtered rows and `findAndCountAll()` totals describe the same result set.

Search composes with `status`, `user_id`, `date_from`, and `date_to` before pagination. No filtering is performed after the database page is returned.

## Ordering

The existing approval-first policy is preserved:

```text
Pending
→ Approved
→ Rejected
→ created_at DESC within each status group
→ booking_id DESC as deterministic tie-breaker
```

The final booking-ID tie-breaker only resolves rows with the same status and creation timestamp; it does not change the product-level ordering policy.

## Processor identity

The database already stores the decision actor in `bookings.approved_by`, a nullable foreign key to `users.id_users`. The field is used for both manual approval and manual rejection, so `approved_by` is not a truthful presentation name.

Add a read-only Sequelize association such as:

```js
Booking.belongsTo(User, {
  foreignKey: 'approved_by',
  targetKey: 'id_users',
  as: 'processor'
});
```
The management read query includes the processor user and its role with `required: false`. The mapper exposes:

```json
{
  "processed_by": {
    "id": 12,
    "full_name": "Eko Prasetyo",
    "role": "Admin"
  }
}
```

When no processor user exists, `processed_by` is `null`.

This distinction is important because `resolveWfaBookings.job.js` automatically rejects expired pending bookings with `processed_at` set and `approved_by: null`. Therefore the canonical states are:

```text
pending
→ processed_at = null
→ processed_by = null

manual approved/rejected
→ processed_at != null
→ processed_by = user object

automated rejection
→ processed_at != null
→ processed_by = null
```

The API must not fabricate a `System` user when no persisted actor identity exists.

For backward compatibility, raw `approved_by` remains in the management-list response during this change. `processed_by` is the canonical presentation field for new clients.

## Response projection

The management list keeps its existing envelope:

```json
{
  "success": true,
  "data": {
    "bookings": [],
    "pagination": {
      "current_page": 1,
      "total_pages": 3,
      "total_items": 25,
      "items_per_page": 10
    }
  },
  "message": "Daftar booking berhasil diambil"
}
```

Each booking row remains sufficiently rich for the current Web FE review drawer. This issue does not slim coordinates or other detail fields out of the list because there is no separate booking-detail endpoint yet.

The canonical management row includes applicant identity, schedule/submission timestamps, reason data, location, suitability, decision state, and processor identity.

Example:

```json
{
  "booking_id": 42,
  "user_id": 7,
  "user_full_name": "Andi Saputra",
  "user_nip_nim": "EMP-007",
  "user_email": "andi@example.com",
  "user_position_name": "Backend Engineer",
  "user_role_name": "Employee",
  "schedule_date": "2026-08-12",
  "created_at": "2026-08-09T05:00:00.000Z",
  "status": "pending",
  "request_reason": {
    "id": 3,
    "label": "Pertemuan dengan klien",
    "is_other": false,
    "other_text": null
  },
  "notes": "Meeting onsite",
  "location": {
    "location_id": 13,
    "latitude": -0.8917,
    "longitude": 119.8707,
    "radius": 100,
    "description": "Coworking Space Palu"
  },
  "radius_snapshot": 100,
  "suitability_score": 82.45,
  "suitability_label": "Baik",
  "processed_at": null,
  "approved_by": null,
  "processed_by": null,
  "rejection_reason": null
}
```

For a manual decision, `processed_by` contains the processor identity while the existing `approved_by` integer remains available during the compatibility period.

## Reason and suitability semantics

The existing nested reason projections remain canonical:

```text
request_reason.other_text
rejection_reason.note
```

INF-274 does not add duplicate flattened `request_other_reason` or `rejection_note` fields to compensate for a stale Web FE normalizer. The downstream Web FE must consume the nested contract correctly.

Suitability follows INF-272 exactly:

- `suitability_score` may be a number, including valid `0`;
- `suitability_label` may be a string;
- both may be `null` when truthful facility evidence cannot produce a ranked result;
- the management list must not synthesize a fallback score or label.

`radius_snapshot` remains the server-owned radius captured at booking submission. The mapper may retain the current legacy fallback to `location.radius` only for rows that predate the snapshot field; new bookings should already persist the snapshot.

## Error handling

Query-shape and filter validation happens before the controller calls the read service.

Invalid management-list input uses the repository's standard Express Validator error path rather than adding new ad-hoc controller validation branches:

```json
{
  "success": false,
  "code": "E_VALIDATION",
  "message": "limit harus bilangan bulat 1-100",
  "errors": [
    {
      "type": "field",
      "value": "101",
      "msg": "limit harus bilangan bulat 1-100",
      "path": "limit",
      "location": "query"
    }
  ]
}
```

Database/query/service failures propagate through `next(error)` to the canonical error middleware. No Sequelize internals are exposed to clients.

Existing authentication and authorization remain unchanged: only Admin and Management may read the management list.

## Compatibility decisions

The public route and top-level response envelope remain unchanged. Existing clients can continue reading current booking fields while new clients adopt `search` and `processed_by`.

`approved_by` is deprecated conceptually for presentation but is not removed by INF-274. A future contract cleanup may remove it only after consumers have migrated.

No sorting behavior is introduced. `sortBy` and `sortOrder` are accepted only as temporary deprecated no-op compatibility inputs because the current Web FE sends them by default. OpenAPI must state that they have no effect and are scheduled for removal after the Web FE stops sending them; all other unknown query keys are rejected.

The employee-facing `/api/bookings/history` response is not migrated to `processed_by` in this issue. INF-274 is bounded to the Admin/Management list that drives Management Booking.

## Test strategy

Implementation uses TDD with focused red-green-refactor cycles around the new read module.

Coverage must pin:

1. query validation for defaults, pagination bounds, status, user ID, strict dates, reversed date ranges, search trimming, unknown keys, non-scalar values, and the temporary `sortBy`/`sortOrder` no-op compatibility exception;
2. search wildcard escaping for backslash, percent, and underscore;
3. search on `full_name` and `nip_nim` only;
4. composition of search with status, user, date range, limit, and offset;
5. approval-first ordering plus deterministic booking-ID tie-breaker;
6. processor include with nested role and `required: false`;
7. mapper output for manual processor, pending null processor, and automated processed/null processor;
8. numeric-zero and nullable suitability preservation;
9. nested request/rejection reason projection;
10. thin controller delegation and unchanged response envelope;
11. Admin/Management authorization and invalid-query rejection at the route boundary;
12. OpenAPI search and `processed_by` contract.
Focused test files should prefer dedicated module tests over growing the legacy controller test indefinitely. Existing booking projection/readiness tests remain regression coverage for unchanged behavior.

Final verification for implementation:

```text
npm run lint
npm test -- --runInBand
git diff --check origin/develop...HEAD
```

Runtime/Postman evidence should verify an authenticated Admin or Management request for search alone, combined search + filters, empty results, manual processed rows, and an automated processed row where processor identity is absent.

## OpenAPI and documentation

Update `docs/openapi.yaml` so `GET /api/bookings` documents canonical `search`, the temporary deprecated no-op `sortBy`/`sortOrder` compatibility inputs, deterministic validation behavior, and nullable `processed_by` processor identity.

Publish a dedicated Management Booking list-item schema matching the existing flattened runtime projection instead of continuing to point the list at the older generic `Booking` schema. The published schema must keep `suitability_score` and `suitability_label` nullable and preserve the nested WFA reason projections.

The client-critical OpenAPI tests must pin the new query and response fields so Web FE cannot depend on undocumented behavior.

An ADR is not required. The design follows the existing bounded read-module direction already used by Management Attendance and does not introduce a new architectural strategy.

## Downstream Web FE contract

The Web FE may render compact list data directly from `GET /api/bookings`. Coordinates and radius are presentation-detail data even while they remain present in the response for compatibility.

Web FE must use `created_at` for **Diajukan** and `schedule_date` for **Jadwal WFA**; these are separate concepts and must not be merged.
The compact table presentation consumes:

```text
Pemohon     ← user_full_name + user_nip_nim + user_position_name
Jadwal WFA  ← schedule_date
Diajukan    ← created_at
Alasan      ← request_reason.label (+ other_text when applicable)
Lokasi      ← location.description
Kelayakan   ← suitability_label + suitability_score, nullable-aware
Status      ← status
Aksi        ← client-owned affordance based on status/permissions
```

The review/detail surface may additionally show email, role, coordinates, radius snapshot, notes, rejection reason/note, `processed_at`, and `processed_by`.

The Web FE normalizer must prefer `request_reason.other_text` and `rejection_reason.note`; Backend will not duplicate these values into legacy flattened fields.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Search changes pagination totals incorrectly | Build search and filters in one `findAndCountAll()` query graph with `distinct: true` |
| SQL wildcard characters broaden search unexpectedly | Escape `\\`, `%`, and `_` before building the `LIKE` pattern |
| Processor join drops automated rows | Processor include uses `required: false` and mapper returns `null` |
| `approved_by` name causes client confusion | Add canonical `processed_by`; retain raw ID only for compatibility |
| Controller grows further | Extract only the management read path into a bounded module |
| INF-272 null scores become fake zero | Mapper explicitly preserves both `null` and numeric `0` |
| Existing Web FE still sends sort parameters | Permit only `sortBy`/`sortOrder` as documented deprecated no-op compatibility inputs; remove them after Web migration |
| Broad Booking rewrite causes regression | Leave create, decision, history, delete, scheduler, and schema unchanged |

## Definition of done

INF-274 is complete when:

- `GET /api/bookings?search=...` searches applicant name and NIP/NIM server-side;
- search composes with all existing supported filters and pagination;
- validation rejects unsupported or malformed management-list query input while allowing only the documented transitional `sortBy`/`sortOrder` no-op exception;
- approval-first ordering remains stable and deterministic;
- each management-list row exposes `processed_by` object or `null` from persisted evidence;
- automated rejection remains representable as processed with no human processor;
- existing raw `approved_by` remains compatible;
- request and rejection reason objects remain nested and canonical;
- nullable and numeric-zero suitability behavior is preserved;
- no database migration is introduced;
- booking creation, decision, employee history, delete, and scheduler behavior are unchanged;
- OpenAPI and focused contract tests match runtime behavior;
- lint and the full relevant Jest suite pass;
- runtime evidence is captured or explicitly marked `Needs Verification` when no authenticated runtime is available.

## Implementation boundary summary

```text
Change:
management booking list validation/query/mapper/read service
processor read association
thin GET /api/bookings adapter
OpenAPI + tests

Do not change:
booking mutation semantics
WFA scoring semantics
employee booking history contract
scheduler decisions
DB schema
Web FE code
```
