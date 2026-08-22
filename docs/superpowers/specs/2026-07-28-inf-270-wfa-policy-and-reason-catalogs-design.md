# INF-270 Server-Authoritative WFA Policy and Reason Catalogs Design — 2026-07-28

Branch: `docs/inf-270-wfa-policy-spec-plan`  
Linear: `INF-270 — Backend: Add Global WFA Policy, Request Reasons, and Rejection Reasons`  
Consumers: `INF-265` Android WFA Request Form, `INF-271` Management Web WFA Settings and Reject Flow  
Design status: approved product direction, documented for implementation planning.

## Goal

Make the backend the final authority for the WFA request radius, allowed request reasons, allowed rejection reasons, and booking approval/rejection validation while preserving the repository's current layer-first architecture.

The resulting backend contract must let Android:

- load the global WFA radius and active request reasons;
- submit a WFA request without sending an authoritative radius;
- receive a backend-confirmed booking result;
- map stable backend failure codes.

It must also let Management Web:

- update the global WFA radius through the existing operational settings endpoint;
- manage request and rejection reason catalogs;
- reject a booking only with an explicit active rejection reason.

## Current repository facts

- Backend stack is Node.js ESM, Express, Sequelize, and MySQL.
- Business timezone is `Asia/Jakarta`.
- `/api/bookings` is owned by `src/routes/booking.routes.js` and `src/controllers/booking.controller.js`.
- `/api/wfa` is owned by `src/routes/wfa.routes.js`.
- `/api/settings` is owned by `src/routes/settings.routes.js`, `src/controllers/settings.controller.js`, and `src/services/operationalSettings.service.js`.
- The existing `settings` table is already the source for operational numeric/time configuration.
- The existing operational settings contract is mapped in `src/utils/settings.js`.
- `bookings` is the runtime source of truth for WFA requests and approvals.
- The legacy `wfa_requests` model/table is not the active Android booking flow and is not migrated in this scope.
- `booking.controller.js` currently owns date validation, duplicate checks, location creation, suitability calculation, booking creation, and status update.
- `resolveWfaBookings.job.js` reads existing booking status/date/location fields and must continue working unchanged.
- The current `bookings.rejection_reason` column is nullable and not part of the active reject contract.

## Locked decisions

1. Preserve the current architecture:

   ```text
   Route
   → auth / role guard / validator
   → Controller
   → focused existing-layer service/helper
   → Sequelize Model
   → MySQL
   ```

2. Do not introduce `src/modules`, repository, adapter, policy, mapper, base-controller, or v2 API layers.
3. Reuse the existing `settings` table and operational settings API for the global WFA radius.
4. Do not create a separate `wfa_settings` table.
5. Add typed relational catalogs for employee request reasons and management rejection reasons.
6. Keep `bookings` as the WFA request source of truth.
7. Do not use the legacy `wfa_requests` table for this flow.
8. Android must not control radius, status, user identity, timestamps, or suitability.
9. Use strict ISO `YYYY-MM-DD` for the canonical booking request date.
10. Backend validation remains authoritative even when Android performs early validation.
11. Used reasons are deactivated, never hard-deleted.
12. Existing booking rows and the legacy `rejection_reason` column must not be destructively discarded.
13. OpenAPI and contract tests are part of the change, not follow-up documentation.

## Architecture

### Request/config flow

```text
GET /api/wfa/request-config
→ verifyToken
→ wfa.routes.js
→ wfaSettings.controller.js
→ wfaSettings.service.js
→ Settings + WfaRequestReason
→ response projection
```

### Management settings flow

```text
GET/PATCH /api/settings/operational
→ existing settings route/controller/service
→ Settings
```

The WFA radius becomes another operational field; the existing settings architecture remains canonical.

### Reason catalog flow

```text
/api/settings/wfa/request-reasons
/api/settings/wfa/rejection-reasons
→ verifyToken
→ roleGuard(['Admin', 'Management'])
→ focused validator
→ wfaSettings.controller.js
→ wfaSettings.service.js
→ reason models
```

### Booking creation flow

```text
POST /api/bookings
→ verifyToken
→ createBookingValidation
→ createBooking
→ resolve WFA settings and active reason
→ server-side date/duplicate/suitability validation
→ Location + Booking transaction
→ backend-confirmed response
```

### Approval/rejection flow

```text
PATCH /api/bookings/:id
→ verifyToken
→ roleGuard(['Admin', 'Management'])
→ updateStatusValidation
→ updateBookingStatus
→ validate active rejection reason when rejected
→ transaction
→ backend-confirmed response
```

## File boundary decisions

The repository remains layer-first, but new logic should not make existing controllers larger than necessary.

Create focused files inside existing folders:

```text
src/controllers/wfaSettings.controller.js
src/services/wfaSettings.service.js
src/middlewares/wfaSettings.validator.js
src/models/wfaRequestReason.model.js
src/models/wfaRejectionReason.model.js
```

Responsibilities:

- `wfaSettings.controller.js`: HTTP orchestration only.
- `wfaSettings.service.js`: read global radius, build employee config, CRUD-lite catalog operations, active-reason resolution, and `is_other` invariant checks.
- `wfaSettings.validator.js`: request body/path validation for catalog endpoints.
- `booking.controller.js`: remains the only booking mutation controller, but delegates WFA setting/reason lookup to the focused service.
- `operationalSettings.service.js`: remains the only mutation path for the global radius setting.

No second booking implementation is introduced.

## Data model

### Existing `settings` table

Add one row through a new migration:

```text
setting_key   = wfa.request.radius_m
setting_value = 100
```

Expose it through the operational settings API as:

```json
{
  "wfaRequestRadiusM": 100
}
```

Update:

```text
OPERATIONAL_SETTING_KEYS
OPERATIONAL_SETTING_DEFAULTS
OPERATIONAL_SETTING_INTEGER_FIELDS
```

The value must be a positive integer. The server must fail with an explicit configuration error when strict runtime reads find the setting missing or invalid.

### `wfa_request_reasons`

```text
id          INTEGER PK AUTO_INCREMENT
label       VARCHAR(120) NOT NULL
is_active   BOOLEAN NOT NULL DEFAULT true
is_other    BOOLEAN NOT NULL DEFAULT false
sort_order  INTEGER NOT NULL DEFAULT 0
created_at  DATETIME NOT NULL
updated_at  DATETIME NOT NULL
```

### `wfa_rejection_reasons`

Use the same column contract as `wfa_request_reasons`.

Catalog invariants:

- trimmed label is required;
- label length is at most 120 characters;
- sort order is a non-negative integer;
- only one active or inactive row per catalog may be marked `is_other = true`;
- a used row cannot be hard-deleted;
- PATCH may update `label`, `is_active`, and `sort_order`;
- `is_other` is fixed after creation to avoid changing historical form semantics.

### Seed defaults

Request reasons:

```text
Pertemuan dengan klien
Pekerjaan lapangan
Perjalanan bisnis
Lainnya (is_other=true)
```

Rejection reasons:

```text
Lokasi tidak memenuhi ketentuan
Tanggal tidak dapat disetujui
Alasan tidak sesuai kebijakan
Data pengajuan belum lengkap
Lainnya (is_other=true)
```

### `bookings` additions

```text
request_reason_id       INTEGER NULL FK → wfa_request_reasons.id
request_other_reason    TEXT NULL
rejection_reason_id     INTEGER NULL FK → wfa_rejection_reasons.id
rejection_note          TEXT NULL
radius_snapshot         INTEGER NULL
```

New booking mutations enforce the required fields in application logic. Columns remain nullable during this bounded migration so existing rows stay valid.

Foreign-key delete behavior is `RESTRICT`. Catalogs use deactivation instead of deletion.

The existing `rejection_reason` column remains untouched in this migration. New code must not write it. A later cleanup may remove or rename it only after production data verification proves that removal is safe.

## API contracts

### Employee configuration

```http
GET /api/wfa/request-config
Authorization: Bearer <token>
```

Response:

```json
{
  "success": true,
  "data": {
    "radius_meters": 100,
    "reasons": [
      {
        "id": 1,
        "label": "Pertemuan dengan klien",
        "is_other": false,
        "sort_order": 10
      }
    ]
  }
}
```

Rules:

- authenticated user access;
- only active request reasons are returned;
- reasons are ordered by `sort_order ASC`, then `id ASC`;
- no settings mutation metadata is exposed;
- missing/invalid strict radius configuration returns `500 WFA_CONFIG_UNAVAILABLE`.

### Operational radius

Reuse the existing routes:

```http
GET   /api/settings/operational
PATCH /api/settings/operational
```

PATCH example:

```json
{
  "wfaRequestRadiusM": 150
}
```

The existing Admin/Management authorization remains unchanged.

### Request reason catalog

```http
GET   /api/settings/wfa/request-reasons
POST  /api/settings/wfa/request-reasons
PATCH /api/settings/wfa/request-reasons/:id
```

POST:

```json
{
  "label": "Kunjungan operasional",
  "is_other": false,
  "sort_order": 30
}
```

PATCH:

```json
{
  "label": "Kunjungan lapangan",
  "is_active": true,
  "sort_order": 30
}
```

GET returns active and inactive rows for management configuration.

### Rejection reason catalog

```http
GET   /api/settings/wfa/rejection-reasons
POST  /api/settings/wfa/rejection-reasons
PATCH /api/settings/wfa/rejection-reasons/:id
```

Use the same CRUD-lite contract and invariants as request reasons.

No DELETE route is added.

## Booking creation contract

```http
POST /api/bookings
```

Canonical request:

```json
{
  "schedule_date": "2026-08-10",
  "request_reason_id": 1,
  "request_other_reason": null,
  "notes": "Pertemuan project",
  "latitude": -0.9,
  "longitude": 119.87,
  "description": "Lokasi klien"
}
```

Required:

```text
schedule_date
request_reason_id
latitude
longitude
```

Conditional:

```text
request_other_reason required only when selected reason is Other
```

Optional:

```text
notes
description
location_id when supported by the validated current location contract
```

Client-authoritative fields:

```text
radius
user_id
status
suitability_score
suitability_label
created_at
approved_by
processed_at
```

must not influence persisted business state.

Compatibility behavior for the first backend rollout:

- legacy clients may still include `radius`, `suitability_score`, or `suitability_label`;
- the backend accepts but ignores them;
- they are removed from the canonical OpenAPI request schema;
- tests prove the persisted radius and suitability are server-resolved.

Server behavior:

1. parse only strict ISO `YYYY-MM-DD`;
2. evaluate date rules using WIB business semantics;
3. resolve user from `req.user.id`;
4. load strict `wfaRequestRadiusM`;
5. resolve the request reason and require it to be active;
6. require trimmed Other text only for an `is_other` reason;
7. reject Other text for non-Other reasons by normalizing it to null;
8. preserve duplicate pending/approved booking rules;
9. calculate suitability on the server;
10. create or reuse the location using the server radius;
11. create the booking as pending;
12. persist request reason fields and `radius_snapshot` in the existing transaction;
13. return backend-confirmed booking data.

### Create response

```json
{
  "success": true,
  "message": "Booking WFA berhasil dibuat.",
  "data": {
    "booking_id": 1042,
    "schedule_date": "2026-08-10",
    "status": "pending",
    "request_reason": {
      "id": 1,
      "label": "Pertemuan dengan klien",
      "is_other": false,
      "other_text": null
    },
    "location": {
      "location_id": 81,
      "latitude": -0.9,
      "longitude": 119.87,
      "radius": 100,
      "description": "Lokasi klien"
    },
    "radius_snapshot": 100,
    "suitability_score": 78.4,
    "suitability_label": "Layak",
    "created_at": "2026-07-28T10:30:00.000Z"
  }
}
```

## Approval and rejection contract

```http
PATCH /api/bookings/:id
```

Approval:

```json
{
  "status": "approved"
}
```

Rejection:

```json
{
  "status": "rejected",
  "rejection_reason_id": 2,
  "rejection_note": "Lokasi berada di luar area operasional."
}
```

Rules:

- status must remain `approved` or `rejected`;
- `rejection_reason_id` is required only for rejection;
- rejection reason must exist and be active;
- `rejection_note` is required and trimmed when the reason is Other;
- non-Other rejection note is optional;
- approval clears or leaves null all new rejection fields;
- existing schedule-date guard, transaction, `approved_by`, and `processed_at` semantics remain intact;
- automated expiry rejection in `resolveWfaBookings.job.js` is not forced to select a human catalog reason in this issue.

System expiry rejection remains identifiable by:

```text
status = rejected
approved_by = null
rejection_reason_id = null
```

This keeps the nightly job behavior stable and distinguishes system rejection from Management rejection.

## Read projection contract

Booking create/list/history/detail/update projections must expose when available:

```text
request_reason { id, label, is_other, other_text }
rejection_reason { id, label, is_other, note }
radius_snapshot
```

Backward compatibility:

- existing rows may have null reason fields;
- existing rows may have null `radius_snapshot`;
- read projection may fall back to `location.radius` for legacy rows only;
- API must not fabricate a reason label for old rows.

## Error contract

Use stable top-level codes for WFA-specific failures while preserving the existing response envelope:

```text
INVALID_SCHEDULE_DATE
WFA_CONFIG_UNAVAILABLE
WFA_REQUEST_REASON_REQUIRED
WFA_REQUEST_REASON_NOT_FOUND
WFA_REQUEST_REASON_NOT_ACTIVE
WFA_OTHER_REASON_REQUIRED
DUPLICATE_BOOKING
REJECTION_REASON_REQUIRED
REJECTION_REASON_NOT_FOUND
REJECTION_REASON_NOT_ACTIVE
REJECTION_NOTE_REQUIRED
WFA_REASON_CATALOG_CONFLICT
```

Recommended shape:

```json
{
  "success": false,
  "code": "WFA_REQUEST_REASON_NOT_ACTIVE",
  "message": "Alasan WFA tidak lagi tersedia.",
  "errors": [
    {
      "field": "request_reason_id",
      "code": "WFA_REQUEST_REASON_NOT_ACTIVE"
    }
  ]
}
```

Android and Management Web map `code`; they must not parse localized message text.

## Migration and rollout

### Migration order

One new forward migration performs:

1. insert `wfa.request.radius_m` when absent;
2. create both catalog tables;
3. seed default reason rows;
4. add nullable booking columns;
5. add indexes and foreign keys;
6. leave legacy `rejection_reason` untouched.

The migration must be idempotency-safe with explicit existence checks where the repository migration conventions support them.

### Rollout order

```text
1. Backend migration and contract deployment
2. Backend smoke verification
3. Android INF-265 integration
4. Management Web INF-271 integration
```

During the compatibility window, backend ignores legacy client radius/suitability inputs. Once supported clients are deployed, removal of compatibility input acceptance can be a separate contract-hardening issue.

## Security and authorization

- All routes require the existing stateful JWT session validation.
- Employee config requires authentication only.
- Settings and reason catalog management uses existing Admin/Management role guards.
- Booking creation scopes identity to `req.user.id`.
- Approval/rejection keeps existing Admin/Management authorization.
- No endpoint accepts arbitrary employee `user_id` for normal booking creation.
- No new token, cookie, session, or role convention is introduced.

## Testing strategy

Required focused tests:

```text
operational radius setting normalization and strict integrity
migration/model/association contract
employee request-config authentication and projection
catalog list/create/update/deactivate and Other invariant
booking ISO date contract
server-authoritative radius and suitability
active/inactive/Other request reason handling
approve without rejection fields
reject missing/inactive/Other reason handling
read projection for new and legacy rows
resolveWfaBookings job regression
OpenAPI/runtime contract alignment
```

Required commands:

```bash
npm run lint
npm test
npm run migrate:status
npm run test:integration  # when test DB is available
git diff --check
```

Required runtime evidence on a disposable/test environment:

```text
GET /api/wfa/request-config
PATCH /api/settings/operational
request reason create/update/deactivate
rejection reason create/update/deactivate
POST /api/bookings with normal reason
POST /api/bookings with Other
POST /api/bookings proving client radius is ignored
PATCH approve
PATCH reject with normal reason
PATCH reject with Other and note
negative RBAC/auth cases
```

## Risks and mitigations

### Existing clients send radius and ambiguous dates

Mitigation:

- accept but ignore radius/suitability during the compatibility window;
- enforce ISO date with a stable error code;
- coordinate deployment with Android INF-265.

### Existing booking rows have no reason or snapshot

Mitigation:

- new columns are nullable;
- projections remain null-safe;
- radius fallback is limited to legacy reads.

### Legacy `rejection_reason` contains unknown production values

Mitigation:

- do not drop or overwrite it;
- add new `rejection_reason_id` separately;
- require production data inspection before any cleanup issue.

### Nightly resolver rejects expired pending bookings without a human reason

Mitigation:

- preserve current job semantics;
- allow system rejections to keep `rejection_reason_id = null` and `approved_by = null`;
- add regression tests proving the job remains idempotent.

### Controller growth

Mitigation:

- use focused `wfaSettings.controller.js` and `wfaSettings.service.js` within the existing layer-first folders;
- keep booking mutation in the existing booking controller;
- do not introduce a parallel booking service architecture.

## Out of scope

```text
INF-252 modular MVC migration
src/modules extraction
repository/adapter/policy/mapper layers
radius per reason/user/division/location
hard deletion of reason rows
generic settings rewrite
legacy wfa_requests cleanup
legacy rejection_reason cleanup
backend idempotency-key contract
Management Web implementation
Android UI implementation
WFA history redesign
attendance/geofence redesign
scheduler behavior changes
```

## Acceptance criteria

- [ ] Current layer-first architecture remains intact.
- [ ] Existing `settings` table owns the global WFA radius.
- [ ] Operational settings expose and update `wfaRequestRadiusM`.
- [ ] Employee config returns radius and active request reasons.
- [ ] Both reason catalogs support list/create/update/deactivate.
- [ ] Used reasons are not hard-deleted.
- [ ] Booking creation uses strict ISO date and authenticated user identity.
- [ ] Client radius and suitability do not control persisted values.
- [ ] Request reason and conditional Other text are validated and persisted.
- [ ] New locations use the server radius.
- [ ] Booking stores `radius_snapshot`.
- [ ] Management rejection requires an active rejection reason.
- [ ] Other rejection requires a note.
- [ ] Approval remains valid without rejection fields.
- [ ] Automated expiry rejection remains stable.
- [ ] New and legacy booking projections are null-safe.
- [ ] Legacy `rejection_reason` data is not discarded.
- [ ] Stable error codes support typed Android/Web mapping.
- [ ] OpenAPI matches runtime behavior.
- [ ] Lint, tests, migration checks, and authenticated smoke evidence are attached before completion.
