# GitHub #139 Management Profile Photo Projection Design

**Date:** 2026-08-10
**Issue:** `Infinite-LearningV1/Infinit_Track_BE#139`
**Coordination:** `Infinite-LearningV1/Infinit_Track_BE#138`
**Downstream:** `Infinite-LearningV1/Infinite_Track_Fe#64`
**Repository:** `Infinite-LearningV1/Infinit_Track_BE`
**Base branch:** `develop`
**Base commit:** `577793842c172018b3cb40c44853438d90c14c22`
**Working branch:** `feature/gh-139-profile-photo-projection`

## Purpose

Expose the existing User profile photo as lightweight identity metadata in Management Attendance and Management Booking responses.

The Backend remains the source of truth for photo identity. Attendance and Booking do not own photo state; they only project the photo metadata needed by their management read surfaces.

This is an additive read-contract change. It does not add a photo endpoint, database migration, upload behavior, storage policy, or client-side lookup requirement.

## Verified baseline

The isolated worktree starts from the merged `develop` commit `5777938`.

Fresh baseline verification:

```text
Test Suites: 146 passed, 146 total
Tests:       1426 passed, 1426 total
npm run lint: PASS
```

## Current verified contract

The photo source already exists and needs no schema work:

- `Photo.photo_url` stores the persisted profile-photo URL.
- `Photo.photo_updated_at` records when that photo record was last replaced.
- `User.belongsTo(Photo, { as: 'photo_file', foreignKey: 'id_photos' })` is already registered.
- a user may have no linked `photo_file`; therefore every client-facing photo projection is nullable even though `photo_url` is non-null on an existing Photo row.

Management User is the reference behavior. Its list/detail queries explicitly LEFT JOIN `photo_file` with only `photo_url` and `photo_updated_at`, then expose `photo` and `photo_updated_at`.

Management Attendance currently joins `User -> Role` but not `Photo`. Its list/detail mapper therefore cannot expose profile-photo metadata.

Management Booking currently joins applicant `User -> Position/Role` but not `Photo`. Its mapper exposes applicant identity as flattened `user_*` fields but has no photo fields.

The dashboard today-locations snapshot independently proves that a nested optional `User -> photo_file` include already works in this repository without changing the User association.

## Product and architecture decisions

Profile photo remains User-owned identity evidence. Attendance and Booking only consume it for presentation-oriented management reads.

The change must remain explicit at each query boundary: an endpoint receives photo metadata only when its own projection asks for it. No query-wide or model-wide implicit photo loading is introduced.

## Scope

This issue covers:

- a small reusable profile-photo projection primitive;
- explicit optional Photo includes in Management Attendance list/detail queries;
- explicit optional Photo include in the Management Booking applicant query;
- additive Attendance and Booking response fields;
- OpenAPI updates for the new nullable fields;
- focused query, mapper, read-service regression, and OpenAPI contract tests.

Out of scope:

- new photo-read endpoints;
- changes to `POST /users/:id/photo` or user creation/update uploads;
- changes to Spaces/Cloudinary storage, URL generation, deletion, or cache policy;
- database migrations or association changes;
- adding photo data to the Booking processor identity;
- changing Attendance search/filter/sort/pagination/detail ownership;
- changing Booking search/filter/order/pagination/approval/rejection semantics;
- refactoring the legacy Management User controller merely to adopt the new helper;
- Web FE implementation from `Infinite_Track_Fe#64`.

## Approaches considered

### A. Duplicate Photo include and null mapping in both features

Smallest file count, but repeats the same association alias, selected attributes, optional-join rule, and null semantics. Future identity surfaces could drift again.

### B. Reusable explicit photo projection primitive — selected

Create a focused helper under `src/utils/userPhotoProjection.js`. Query builders still opt in explicitly by passing the `Photo` model; response mappers reuse one null-safe projection rule.

Benefits:

- preserves explicit data ownership at each query;
- avoids a global ORM scope;
- keeps Attendance and Booking mapping semantics aligned;
- stays small enough for this bounded contract change;
- can be adopted by future identity projections without forcing a refactor of existing consumers.

### C. Dedicated photo endpoint or global User photo scope

Rejected. A dedicated endpoint encourages N+1 HTTP calls for paginated tables. A global User scope makes every User read pay for or depend on Photo implicitly, including flows that do not need presentation identity.

## Shared projection primitive

The selected helper has two responsibilities only:

```js
buildUserPhotoInclude(PhotoModel)
mapUserPhotoProjection(user)
```

`buildUserPhotoInclude` returns an optional `photo_file` include selecting exactly `photo_url` and `photo_updated_at`. It receives the model as a dependency rather than importing the model registry itself.

`mapUserPhotoProjection` is ORM-agnostic and returns exactly `{ photo, photo_updated_at }`, with both values `null` when `user.photo_file` is absent.

The conceptual shape is:

```js
export const buildUserPhotoInclude = (PhotoModel) => ({
  model: PhotoModel,
  as: 'photo_file',
  attributes: ['photo_url', 'photo_updated_at'],
  required: false
});

export const mapUserPhotoProjection = (user) => ({
  photo: user?.photo_file?.photo_url ?? null,
  photo_updated_at: user?.photo_file?.photo_updated_at ?? null
});
```

The helper does not fetch, upload, transform, validate, sign, or cache image URLs. It only describes the existing association projection and null-safe output.

Management User remains unchanged in this issue. Its current explicit implementation is regression/reference evidence, not a mandatory migration target.

## Management Attendance query contract

Both list and detail User includes add the optional photo include next to the existing Role include.

The parent User join keeps its current `required` behavior: list search may require User; detail remains optional. The nested Photo join is always `required: false`, so a missing photo never removes an attendance row or changes pagination totals.

No Attendance top-level attributes, where conditions, order, limit, offset, or location joins change.

## Management Attendance response contract

The existing nested user object is extended additively in both list and detail:

```json
{
  "user": {
    "id": 7,
    "full_name": "Andi Saputra",
    "nip_nim": "EMP-007",
    "role": "User",
    "photo": "https://cdn.example.com/users/7/profile/photo.jpg",
    "photo_updated_at": "2026-08-10T08:30:00.000Z"
  }
}
```

Detail continues to include `email` in the same user object; the photo field names remain identical between list and detail.

When no photo exists:

```json
{
  "photo": null,
  "photo_updated_at": null
}
```

The mapper always emits both keys. Nullable values distinguish missing identity evidence from an omitted/undocumented contract field.

No default URL is synthesized and no User profile lookup is attempted after the attendance query returns.

## Management Booking query contract

Only the applicant User include receives the optional Photo include. The existing applicant Position and Role joins remain unchanged.

The processor include intentionally does not load Photo: `processed_by` identifies the decision actor but the current Management Booking presentation does not require a processor avatar.

Applicant search behavior is unchanged. When `search` is active, the applicant User include remains required; its nested Photo include remains optional. Therefore a user without a profile photo can still match search and return a booking row.

No Booking where condition, fixed approval-first order, limit, offset, `distinct`, location/reason joins, or pagination envelope changes.

## Management Booking response contract

The existing flattened applicant projection is preserved and extended with:

```json
{
  "user_id": 7,
  "user_full_name": "Andi Saputra",
  "user_nip_nim": "EMP-007",
  "user_photo": "https://cdn.example.com/users/7/profile/photo.jpg",
  "user_photo_updated_at": "2026-08-10T08:30:00.000Z"
}
```

Both new fields are always present and nullable. For an applicant without a photo:

```json
{
  "user_photo": null,
  "user_photo_updated_at": null
}
```

The issue does not convert Booking to a nested User object. Existing fields such as `user_email`, `user_position_name`, and `user_role_name` remain compatible.

## Data flow

```text
GET /api/attendance or GET /api/bookings
        ↓
existing validation/controller/read service
        ↓
feature query builder explicitly includes applicant/employee User
        ↓
optional User.photo_file LEFT JOIN
        ↓
Sequelize row
        ↓
feature mapper uses shared null-safe photo projection
        ↓
existing response envelope + additive photo fields
        ↓
Web FE #64 renders photo or initials
```

There is still one list/detail database query per existing use case. No additional HTTP request is introduced and no per-row database query is executed by application code.

## Truthfulness and error semantics

A missing `photo_file` is normal nullable identity evidence, not an API error. It must not cause a 404, drop the parent row, or generate a warning/error response.

A persisted `photo_url` is returned as stored. This issue does not probe the remote object or replace an unreachable URL; broken-image recovery belongs to Web FE presentation.

`photo_updated_at` is returned from persisted Photo evidence and is not replaced by the current time, User `updated_at`, or Booking/Attendance timestamps.

Existing database/service failures continue through the current error path. The helper does not introduce a new error envelope.

## OpenAPI contract

`docs/openapi.yaml` must document the runtime additions explicitly.

`AttendanceAuditListRow.user` adds required-but-nullable properties:

```text
photo
photo_updated_at
```

`AttendanceAuditDetail.user` adds the same properties while retaining detail-only `email`.

`BookingManagementItem` adds nullable applicant properties to its existing schema:

```text
user_photo
user_photo_updated_at
```

`photo`/`user_photo` are strings with URI format when present. `photo_updated_at`/`user_photo_updated_at` are date-time strings when present.

No endpoint, request parameter, pagination schema, authorization rule, or status code is added or changed.

A new ADR is not required. This change follows the existing explicit User-photo projection pattern and the bounded read modules already established by INF-267 and INF-274.

## Test strategy

Implementation uses TDD in small red-green-refactor cycles.

Focused coverage must prove:

1. the shared include selects only `photo_url` and `photo_updated_at`, uses alias `photo_file`, and is optional;
2. the shared mapper preserves persisted URL/timestamp and returns two nulls when photo evidence is absent;
3. Attendance list User include contains optional Role and Photo children without changing search-required behavior;
4. Attendance detail User include contains the same Photo child without changing detail attributes;
5. Attendance list and detail mappers emit photo fields for present and absent photos;
6. Attendance read-service fixtures/mocks remain compatible with the expanded query model dependency;
7. Booking applicant include contains Photo while processor include does not;
8. Booking mapper exposes `user_photo` and `user_photo_updated_at` for present and absent photos;
9. Booking fixed ordering, search, filters, and canonical/deprecated pagination fields remain unchanged;
10. OpenAPI publishes the exact nullable fields on Attendance list/detail and Booking management items;
11. Management User photo projection remains green as reference regression coverage.

Likely focused tests:

```text
tests/userPhotoProjection.test.js
tests/attendanceManagementQuery.test.js
tests/attendanceManagementMapper.test.js
tests/attendanceManagementReadService.test.js
tests/attendanceManagementOpenApiContract.test.js
tests/bookingManagementQuery.test.js
tests/bookingManagementMapper.test.js
tests/bookingManagementReadService.test.js
tests/bookingManagementOpenApiContract.test.js
tests/userListProjectionContract.test.js
```

Final implementation gates:

```text
npm run lint
npm test -- --runInBand
git diff --check refs/remotes/origin/develop...HEAD
```

Runtime evidence should verify authenticated Management/Admin responses for an employee with a photo and an employee without one on both Attendance and Booking. If compatible authenticated runtime evidence is unavailable, the PR must say `Needs Verification` rather than inventing it.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Optional photo join accidentally removes rows | Nested Photo include is always `required: false`; query tests pin this |
| Attendance pagination/search changes through join behavior | Preserve the existing parent User `required` rule, `distinct`, filters, order, limit, and offset |
| Booking processor unnecessarily loads applicant photo semantics | Add Photo only to the applicant include; processor remains unchanged |
| Null photo becomes a fabricated default | Shared mapper returns explicit `null`; no fallback URL exists in Backend |
| Timestamp semantics drift | Return only persisted `photo_updated_at`; do not synthesize timestamps |
| Contract fields differ between Attendance list/detail | Both use the same shared photo projection and exact field names |
| Broad User controller refactor creates unrelated risk | Leave Management User implementation unchanged in #139 |
| New helper becomes implicit global behavior | Queries must call `buildUserPhotoInclude(Photo)` explicitly |
| OpenAPI drifts from runtime | Focused OpenAPI tests require fields and nullable semantics |

## Definition of done

GitHub #139 is complete when the additive photo projection is implemented and verified without changing existing Attendance/Booking business semantics.

Specifically:

- Attendance list returns `user.photo` and `user.photo_updated_at` on every row, nullable when evidence is absent;
- Attendance detail returns the same two fields in its user identity object;
- Booking management rows return `user_photo` and `user_photo_updated_at`, nullable when absent;
- persisted photo URL/timestamp values are preserved without rewriting or fabrication;
- both feature query builders opt into the same optional lightweight Photo projection;
- missing photos do not remove Attendance or Booking rows;
- no new API route, DB migration, global User scope, per-row query, or photo-storage change exists;
- existing Attendance query/detail/pagination semantics remain unchanged;
- existing Booking search/filter/order/decision/pagination semantics remain unchanged;
- OpenAPI matches runtime and focused contract tests cover present/null cases;
- `npm run lint`, the full Jest suite, and `git diff --check` pass with fresh evidence;
- downstream Web FE #64 can consume Backend-authored photo metadata without User-detail lookup workarounds.

## Implementation boundary summary

```text
Change:
shared explicit user-photo projection helper
Management Attendance User query include + mapper output
Management Booking applicant query include + mapper output
OpenAPI + focused tests

Do not change:
Photo/User schema or associations
photo upload/storage/delete behavior
Attendance mutations/jobs/business rules
Booking decisions/scoring/business rules
search/filter/sort/pagination semantics
Management User implementation
Web FE code
```
