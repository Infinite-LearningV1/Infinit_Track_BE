# GitHub #139 Management Profile Photo Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Backend-authored profile-photo metadata to Management Attendance list/detail and Management Booking applicant rows without adding endpoints, migrations, N+1 lookups, or implicit global photo loading.

**Architecture:** Keep Photo owned by User. Add one small reusable explicit projection helper under `src/utils/`, then make the existing Attendance and Booking query builders opt into the optional `User -> photo_file` join and map the result into their existing response shapes. Preserve every existing request, filter, sorting, pagination, authorization, mutation, and storage contract.

**Tech Stack:** Node.js ESM, Express 4, Sequelize 6, MySQL, Jest 29 with VM modules, OpenAPI YAML.

## Global Constraints

- Base branch: `develop`; implementation worktree base commit: `577793842c172018b3cb40c44853438d90c14c22`.
- Work only on `feature/gh-139-profile-photo-projection` in the isolated worktree.
- TDD is mandatory: each production behavior starts with a focused failing test.
- No new route, endpoint, request parameter, status code, or response envelope.
- No database migration or User/Photo association change.
- No photo upload, storage, deletion, URL signing, probing, caching, or fallback behavior.
- No global/default Sequelize scope that loads Photo implicitly.
- No per-row database query and no User-detail HTTP lookup.
- Attendance photo fields are exactly `user.photo` and `user.photo_updated_at` in list and detail.
- Booking applicant photo fields are exactly `user_photo` and `user_photo_updated_at`.
- Booking `processed_by` does not gain photo fields.
- Missing photo evidence produces explicit `null` values and never removes the parent row.
- Preserve Attendance search/filter/sort/pagination/detail semantics unchanged.
- Preserve Booking search/filter/order/pagination/approval/rejection/scoring semantics unchanged.
- Leave Management User implementation unchanged; use its tests only as regression/reference evidence.

---## File Map

**Create**
- `src/utils/userPhotoProjection.js` — reusable explicit Sequelize include descriptor plus null-safe photo metadata mapper.
- `tests/userPhotoProjection.test.js` — pins helper alias, selected attributes, optionality, persisted values, and null semantics.

**Modify — Attendance**
- `src/modules/attendance/attendance.query.js` — explicitly include `Photo` under the existing User include for list and detail.
- `src/modules/attendance/attendance.mapper.js` — add `photo` and `photo_updated_at` to the nested user projection.
- `tests/attendanceManagementQuery.test.js` — pin optional Photo include without changing parent User search behavior.
- `tests/attendanceManagementMapper.test.js` — pin present/null photo fields in list and detail.
- `tests/attendanceManagementReadService.test.js` — add the `Photo` model mock required by the real query builder and keep service behavior unchanged.

**Modify — Booking**
- `src/modules/booking/bookingManagement.query.js` — explicitly include `Photo` for applicant User only.
- `src/modules/booking/bookingManagement.mapper.js` — add flattened `user_photo` and `user_photo_updated_at`.
- `tests/bookingManagementQuery.test.js` — pin applicant Photo include and processor exclusion.
- `tests/bookingManagementMapper.test.js` — pin present/null applicant photo projection.

**Modify — Public contract**
- `docs/openapi.yaml` — document Attendance list/detail nested photo fields and Booking flattened applicant photo fields.
- `tests/attendanceManagementOpenApiContract.test.js` — pin exact nullable Attendance photo schema.
- `tests/bookingManagementOpenApiContract.test.js` — pin exact nullable Booking photo schema.

**Regression only; do not modify unless a scoped failure proves necessary**
- `tests/bookingManagementReadService.test.js`
- `tests/userListProjectionContract.test.js`
### Task 1: Lock the shared explicit User photo projection primitive

**Files:**
- Create: `tests/userPhotoProjection.test.js`
- Create: `src/utils/userPhotoProjection.js`

**Interfaces:**
- Produces: `buildUserPhotoInclude(PhotoModel)` returning a Sequelize include object.
- Produces: `mapUserPhotoProjection(user)` returning `{ photo, photo_updated_at }`.
- Consumed by: Attendance query/mapper in Task 2 and Booking query/mapper in Task 3.

- [ ] **Step 1: Write the failing helper contract test**

```js
import {
  buildUserPhotoInclude,
  mapUserPhotoProjection
} from '../src/utils/userPhotoProjection.js';

const Photo = { modelName: 'Photo' };

test('builds the explicit optional photo_file include', () => {
  expect(buildUserPhotoInclude(Photo)).toEqual({
    model: Photo,
    as: 'photo_file',
    attributes: ['photo_url', 'photo_updated_at'],
    required: false
  });
});
``````js
test('maps persisted photo evidence without rewriting it', () => {
  const updatedAt = new Date('2026-08-10T08:30:00.000Z');
  expect(mapUserPhotoProjection({
    photo_file: {
      photo_url: 'https://cdn.example.com/users/7/profile/photo.jpg',
      photo_updated_at: updatedAt
    }
  })).toEqual({
    photo: 'https://cdn.example.com/users/7/profile/photo.jpg',
    photo_updated_at: updatedAt
  });
});

test.each([null, undefined, {}, { photo_file: null }])(
  'maps absent photo evidence to explicit nulls',
  (user) => {
    expect(mapUserPhotoProjection(user)).toEqual({
      photo: null,
      photo_updated_at: null
    });
  }
);
```

- [ ] **Step 2: Run the helper test and verify RED**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/userPhotoProjection.test.js --runInBand`

Expected: FAIL because `src/utils/userPhotoProjection.js` does not exist.
- [ ] **Step 3: Implement the minimal shared helper**

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

Do not import `Photo` or `models/index.js` in this helper. Query builders must opt in explicitly by passing the model.

- [ ] **Step 4: Run the helper test and verify GREEN**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/userPhotoProjection.test.js --runInBand`

Expected: PASS with all helper tests green.

- [ ] **Step 5: Commit the helper contract**

```powershell
git add -- src/utils/userPhotoProjection.js tests/userPhotoProjection.test.js
git commit -m "feat(#139): add explicit user photo projection helper"
```
### Task 2: Project profile photo through Management Attendance list and detail

**Files:**
- Modify: `tests/attendanceManagementQuery.test.js`
- Modify: `tests/attendanceManagementMapper.test.js`
- Modify: `tests/attendanceManagementReadService.test.js`
- Modify: `src/modules/attendance/attendance.query.js`
- Modify: `src/modules/attendance/attendance.mapper.js`

**Interfaces:**
- Consumes: `buildUserPhotoInclude(PhotoModel)` and `mapUserPhotoProjection(user)` from Task 1.
- Produces: list/detail nested user objects containing `photo` and `photo_updated_at` on every mapped Attendance row.
- Keeps: existing parent User required/search behavior, fields, filters, ordering, pagination, detail location semantics, and service envelope.

- [ ] **Step 1: Write RED query assertions for the optional nested Photo join**

Change the test import to:

```js
import { AttendanceStatus, Photo, User } from '../src/models/index.js';
```

Add:

```js
test('includes the same optional lightweight photo projection in list and detail', () => {
  const list = buildAttendanceListQuery({ page: 1, limit: 10 });
  const listUser = list.include.find((item) => item.as === 'user');
  const listPhoto = listUser.include.find((item) => item.as === 'photo_file');

  expect(listUser.required).toBe(false);
  expect(listPhoto).toEqual({
    model: Photo, as: 'photo_file',
    attributes: ['photo_url', 'photo_updated_at'], required: false
  });
``````js
  const searched = buildAttendanceListQuery({ page: 1, limit: 10, search: 'Andi' });
  expect(searched.include.find((item) => item.as === 'user').required).toBe(true);

  const detail = buildAttendanceDetailQuery();
  const detailUser = detail.include.find((item) => item.as === 'user');
  const detailPhoto = detailUser.include.find((item) => item.as === 'photo_file');
  expect(detailUser.required).toBe(false);
  expect(detailPhoto).toEqual({
    model: Photo, as: 'photo_file',
    attributes: ['photo_url', 'photo_updated_at'], required: false
  });
});
```

This test must not change the expected top-level include aliases, list `limit`/`offset`, or stable ordering assertions already present.

- [ ] **Step 2: Extend Attendance mapper fixtures and expectations before production code**

Add `photo_file` to the shared `row.user` fixture:

```js
photo_file: {
  photo_url: 'https://cdn.example.com/users/7/profile/photo.jpg',
  photo_updated_at: new Date('2026-08-10T08:30:00.000Z')
}
```

Update the exact list-user expectation to include those two projected values.
Add a null-evidence mapper test:

```js
test('keeps photo fields present and null when the user has no linked photo', () => {
  const noPhoto = {
    ...row,
    user: { ...row.user, photo_file: null }
  };

  expect(mapAttendanceListRow(noPhoto).user).toMatchObject({
    photo: null,
    photo_updated_at: null
  });
  expect(mapAttendanceDetail(noPhoto).user).toMatchObject({
    photo: null,
    photo_updated_at: null
  });
});
```

Update the existing `user: null` exact expectation to:

```js
{
  id: null,
  full_name: null,
  nip_nim: null,
  photo: null,
  photo_updated_at: null,
  role: null
}
```
- [ ] **Step 3: Update the Attendance read-service test fixture/mocks and verify the suite is RED**

In `tests/attendanceManagementReadService.test.js`:

```js
jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: { findAndCountAll, findByPk },
  User: {},
  Role: {},
  Photo: {},
  Location: {},
  AttendanceStatus: {},
  AttendanceCategory: {}
}));
```

Add the same `photo_file` fixture under `row.user`, then update the list result expectation to include:

```js
photo: 'https://cdn.example.com/users/7/profile/photo.jpg',
photo_updated_at: new Date('2026-08-10T08:30:00.000Z')
```

Run:

`node --experimental-vm-modules node_modules/jest/bin/jest.js tests/attendanceManagementQuery.test.js tests/attendanceManagementMapper.test.js tests/attendanceManagementReadService.test.js --runInBand`

Expected: FAIL because the query does not yet include Photo and the mapper does not emit the new fields.
- [ ] **Step 4: Implement the minimal Attendance query integration**

Change the model import to include `Photo`, and import the helper:

```js
import {
  AttendanceCategory, AttendanceStatus, Location, Photo, Role, User
} from '../../models/index.js';
import { buildUserPhotoInclude } from '../../utils/userPhotoProjection.js';
```

Change both existing User `include` arrays to contain Role plus the photo include:

```js
include: [
  { model: Role, as: 'role', attributes: ['role_name'], required: false },
  buildUserPhotoInclude(Photo)
]
```

Do not change `userInclude.required`, search predicates, parent User attributes, top-level includes, ordering, limit, offset, or `distinct`.

- [ ] **Step 5: Implement the minimal Attendance mapper integration**

Add:

```js
import { mapUserPhotoProjection } from '../../utils/userPhotoProjection.js';
```
Then extend `userOf` without changing email or role semantics:

```js
const userOf = (row, includeEmail = false) => ({
  id: row.user?.id_users ?? null,
  full_name: row.user?.full_name ?? null,
  nip_nim: row.user?.nip_nim ?? null,
  ...(includeEmail ? { email: row.user?.email ?? null } : {}),
  ...mapUserPhotoProjection(row.user),
  role: row.user?.role?.role_name ?? null
});
```

- [ ] **Step 6: Run the focused Attendance tests and verify GREEN**

Run:

`node --experimental-vm-modules node_modules/jest/bin/jest.js tests/attendanceManagementQuery.test.js tests/attendanceManagementMapper.test.js tests/attendanceManagementReadService.test.js --runInBand`

Expected: PASS. Existing assertions for search-required User joins, detail fields, pagination, modes/statuses, location semantics, and ordering remain green.

- [ ] **Step 7: Commit the Attendance projection**

```powershell
git add -- src/modules/attendance/attendance.query.js src/modules/attendance/attendance.mapper.js tests/attendanceManagementQuery.test.js tests/attendanceManagementMapper.test.js tests/attendanceManagementReadService.test.js
git commit -m "feat(#139): project profile photo in attendance reads"
```
### Task 3: Project applicant profile photo through Management Booking

**Files:**
- Modify: `tests/bookingManagementQuery.test.js`
- Modify: `tests/bookingManagementMapper.test.js`
- Modify: `src/modules/booking/bookingManagement.query.js`
- Modify: `src/modules/booking/bookingManagement.mapper.js`

**Interfaces:**
- Consumes: `buildUserPhotoInclude(PhotoModel)` and `mapUserPhotoProjection(user)` from Task 1.
- Produces: every Management Booking row contains nullable `user_photo` and `user_photo_updated_at` fields derived from the applicant User only.
- Keeps: applicant search behavior, Position/Role joins, processor identity, fixed approval-first ordering, filters, pagination, WFA reason/scoring semantics.

- [ ] **Step 1: Write RED Booking query assertions**

Add `Photo` to the mocked model registry:

```js
const Photo = { modelName: 'Photo' };

jest.unstable_mockModule('../src/models/index.js', () => ({
  User,
  Position,
  Role,
  Photo,
  Location,
  BookingStatus,
  WfaRequestReason,
  WfaRejectionReason
}));
```
Extend the existing applicant include assertion:

```js
expect(applicant.include).toEqual(expect.arrayContaining([
  expect.objectContaining({ model: Position, as: 'position' }),
  expect.objectContaining({ model: Role, as: 'role' }),
  {
    model: Photo,
    as: 'photo_file',
    attributes: ['photo_url', 'photo_updated_at'],
    required: false
  }
]));
```

In the processor test, prove the photo include is absent:

```js
expect(processor.include.some((item) => item.as === 'photo_file')).toBe(false);
```

Keep the existing no-search applicant `required: false`, active-search `required: true`, wildcard escaping, fixed order, limit, offset, and `distinct` assertions unchanged.

- [ ] **Step 2: Write RED Booking mapper assertions**

Add to `baseRow.user`:

```js
photo_file: {
  photo_url: 'https://cdn.example.com/users/7/profile/photo.jpg',
  photo_updated_at: new Date('2026-08-10T08:30:00.000Z')
}
```
Extend the existing manual-processor mapping assertion with:

```js
user_photo: 'https://cdn.example.com/users/7/profile/photo.jpg',
user_photo_updated_at: new Date('2026-08-10T08:30:00.000Z')
```

Add a null-evidence mapper test:

```js
test('keeps applicant photo fields present and null without linked photo evidence', () => {
  const result = mapBookingManagementRow({
    ...baseRow,
    user: { ...baseRow.user, photo_file: null },
    processor: null,
    request_reason: null,
    rejection_reason_detail: null,
    radius_snapshot: 100
  });

  expect(result.user_photo).toBeNull();
  expect(result.user_photo_updated_at).toBeNull();
});
```

- [ ] **Step 3: Run the focused Booking tests and verify RED**

Run:

`node --experimental-vm-modules node_modules/jest/bin/jest.js tests/bookingManagementQuery.test.js tests/bookingManagementMapper.test.js tests/bookingManagementReadService.test.js --runInBand`

Expected: query/mapper tests FAIL because applicant Photo is not yet included and mapped; read-service regression remains green or fails only because mapped fixture expectations were intentionally expanded.
- [ ] **Step 4: Implement the minimal Booking query integration**

Change the model import to include `Photo`, then import the helper:

```js
import {
  BookingStatus,
  Location,
  Photo,
  Position,
  Role,
  User,
  WfaRejectionReason,
  WfaRequestReason
} from '../../models/index.js';
import { buildUserPhotoInclude } from '../../utils/userPhotoProjection.js';
```

Append the photo include only inside `buildApplicantInclude`:

```js
include: [
  { model: Position, as: 'position', attributes: ['position_name'], required: false },
  { model: Role, as: 'role', attributes: ['id_roles', 'role_name'], required: false },
  buildUserPhotoInclude(Photo)
]
```

Do not modify `buildProcessorInclude`.
- [ ] **Step 5: Implement the minimal Booking mapper integration**

Import the shared mapper:

```js
import { mapUserPhotoProjection } from '../../utils/userPhotoProjection.js';
```

Inside `mapBookingManagementRow`, derive the applicant photo once:

```js
const { photo, photo_updated_at: photoUpdatedAt } = mapUserPhotoProjection(row.user);
```

Add these fields next to the existing applicant identity projection:

```js
user_photo: photo,
user_photo_updated_at: photoUpdatedAt,
```

Do not change `processed_by`, reasons, suitability, radius fallback, location conversion, status, timestamps, or raw `approved_by` compatibility.

- [ ] **Step 6: Run the focused Booking tests and verify GREEN**

Run:

`node --experimental-vm-modules node_modules/jest/bin/jest.js tests/bookingManagementQuery.test.js tests/bookingManagementMapper.test.js tests/bookingManagementReadService.test.js --runInBand`

Expected: PASS with processor-photo exclusion and all existing ordering/search/pagination/scoring assertions still green.

- [ ] **Step 7: Commit the Booking projection**

```powershell
git add -- src/modules/booking/bookingManagement.query.js src/modules/booking/bookingManagement.mapper.js tests/bookingManagementQuery.test.js tests/bookingManagementMapper.test.js
git commit -m "feat(#139): project applicant photo in booking reads"
```
### Task 4: Publish the additive photo fields in OpenAPI

**Files:**
- Modify: `tests/attendanceManagementOpenApiContract.test.js`
- Modify: `tests/bookingManagementOpenApiContract.test.js`
- Modify: `docs/openapi.yaml`

**Interfaces:**
- Documents runtime fields produced by Tasks 2 and 3.
- Attendance list/detail photo fields are required keys with nullable values.
- Booking photo fields are nullable properties on the existing `BookingManagementItem` schema; do not create a new booking schema or change its pagination schema.

- [ ] **Step 1: Write RED Attendance OpenAPI assertions**

Add:

```js
test('documents nullable profile photo evidence on attendance list and detail users', () => {
  const listUser = api.components.schemas.AttendanceAuditListRow.properties.user;
  const detailUser = api.components.schemas.AttendanceAuditDetail.properties.user;

  for (const user of [listUser, detailUser]) {
    expect(user.required).toEqual(expect.arrayContaining(['photo', 'photo_updated_at']));
    expect(user.properties.photo).toMatchObject({
      type: 'string', format: 'uri', nullable: true
    });
    expect(user.properties.photo_updated_at).toMatchObject({
      type: 'string', format: 'date-time', nullable: true
    });
  }
});
```
- [ ] **Step 2: Write RED Booking OpenAPI assertions**

Extend the existing `BookingManagementItem` schema test:

```js
expect(item.properties.user_photo).toMatchObject({
  type: 'string',
  format: 'uri',
  nullable: true
});
expect(item.properties.user_photo_updated_at).toMatchObject({
  type: 'string',
  format: 'date-time',
  nullable: true
});
```

Do not add these fields to `BookingProcessor`.

- [ ] **Step 3: Run only the two OpenAPI tests and verify RED**

Run:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/attendanceManagementOpenApiContract.test.js tests/bookingManagementOpenApiContract.test.js --runInBand
```

Expected: FAIL because the four new schema properties are not yet documented.
- [ ] **Step 4: Update the Attendance OpenAPI user schemas**

For both `AttendanceAuditListRow.properties.user` and `AttendanceAuditDetail.properties.user`:

1. add `photo` and `photo_updated_at` to the nested `required` array;
2. add these exact properties:

```yaml
photo:
  type: string
  format: uri
  nullable: true
photo_updated_at:
  type: string
  format: date-time
  nullable: true
```

Keep list-only/detail-only differences unchanged: list still omits email and detail still includes email.

- [ ] **Step 5: Update `BookingManagementItem` only**

Add:

```yaml
user_photo:
  type: string
  format: uri
  nullable: true
user_photo_updated_at:
  type: string
  format: date-time
  nullable: true
```
Do not modify `BookingProcessor`, `BookingManagementPagination`, endpoint parameters, authorization descriptions, or response envelopes.

- [ ] **Step 6: Run the OpenAPI contract tests and verify GREEN**

Run:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/attendanceManagementOpenApiContract.test.js tests/bookingManagementOpenApiContract.test.js tests/clientCriticalOpenApiContract.test.js --runInBand
```

Expected: PASS. The client-critical OpenAPI regression must remain green.

- [ ] **Step 7: Commit the public contract**

```powershell
git add -- docs/openapi.yaml tests/attendanceManagementOpenApiContract.test.js tests/bookingManagementOpenApiContract.test.js
git commit -m "docs(#139): publish management profile photo fields"
```

---

### Task 5: Cross-feature regression and completion verification

**Files:**
- No new production behavior.
- Modify only a file already listed above if fresh verification proves a scoped #139 defect.

**Interfaces:**
- Produces fresh evidence that the additive projection did not change adjacent Attendance, Booking, User, OpenAPI, architecture, or lint behavior.
- [ ] **Step 1: Run the focused cross-feature contract suite**

Run:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/userPhotoProjection.test.js tests/attendanceManagementQuery.test.js tests/attendanceManagementMapper.test.js tests/attendanceManagementReadService.test.js tests/attendanceManagementOpenApiContract.test.js tests/bookingManagementQuery.test.js tests/bookingManagementMapper.test.js tests/bookingManagementReadService.test.js tests/bookingManagementOpenApiContract.test.js tests/userListProjectionContract.test.js tests/architectureLayerRules.test.js --runInBand
```

Expected: all listed suites pass with zero failures.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: exit code `0` with no ESLint errors.

- [ ] **Step 3: Run the complete non-integration Jest baseline**

Run: `npm test -- --runInBand`

Expected: all suites/tests pass. Record the fresh counts; do not reuse the pre-implementation baseline count of `146 suites / 1426 tests` as completion evidence.

- [ ] **Step 4: Verify whitespace and exact diff scope against the unambiguous remote-tracking ref**

Run:

```powershell
git diff --check refs/remotes/origin/develop...HEAD
git diff --stat refs/remotes/origin/develop...HEAD
git diff --name-only refs/remotes/origin/develop...HEAD
git status --short --branch
```
Expected production/documentation scope is limited to:

```text
src/utils/userPhotoProjection.js
src/modules/attendance/attendance.query.js
src/modules/attendance/attendance.mapper.js
src/modules/booking/bookingManagement.query.js
src/modules/booking/bookingManagement.mapper.js
docs/openapi.yaml
focused tests listed in Tasks 1-4
spec/plan documentation commits
```

The diff must not contain migrations, route files, controllers, auth/session code, attendance mutations/jobs, booking mutations, WFA scoring, storage config, Docker files, or Web FE files.

- [ ] **Step 5: Verify the intended runtime contract if authenticated runtime access already exists**

For one Management/Admin session, inspect `GET /api/attendance?page=1&limit=10` and `GET /api/bookings?page=1&limit=10` for both a user with a linked photo and a user without one. Confirm:

```text
Attendance with photo     → user.photo != null; user.photo_updated_at != null
Attendance without photo  → user.photo == null; user.photo_updated_at == null
Booking with photo        → user_photo != null; user_photo_updated_at != null
Booking without photo     → user_photo == null; user_photo_updated_at == null
```

Also confirm row counts/pagination remain consistent with the same requests before this feature. If no authenticated runtime session is already available, do not invent credentials or claim runtime evidence; record `Runtime evidence: Needs Verification` in the PR handoff.

- [ ] **Step 6: Review commit history and final requirement coverage**

Run:

```powershell
git log --oneline refs/remotes/origin/develop..HEAD
```
Expected implementation commit sequence after the already-committed design spec:

```text
feat(#139): add explicit user photo projection helper
feat(#139): project profile photo in attendance reads
feat(#139): project applicant photo in booking reads
docs(#139): publish management profile photo fields
```

Do not create a verification-only commit unless verification exposes and fixes a scoped defect.

## Completion Checklist

Before calling GitHub #139 implementation-ready for PR:

- [ ] shared include selects only `photo_url` and `photo_updated_at` and is always optional;
- [ ] shared mapper returns persisted evidence unchanged and explicit nulls when absent;
- [ ] Attendance list and detail both expose `user.photo` and `user.photo_updated_at`;
- [ ] Attendance search-required User behavior and pagination remain unchanged;
- [ ] Booking applicant exposes `user_photo` and `user_photo_updated_at`;
- [ ] Booking processor has no photo include/fields;
- [ ] Booking ordering/search/filter/pagination/scoring/reason behavior remains unchanged;
- [ ] Management User regression coverage remains green without refactoring its controller;
- [ ] OpenAPI matches the four new nullable fields exactly;
- [ ] no route, controller, migration, storage, scheduler, auth, or mutation file enters the diff;
- [ ] focused tests, lint, full Jest suite, and `git diff --check` have fresh passing evidence;
- [ ] runtime evidence is either captured truthfully or explicitly marked `Needs Verification`.
