# GitHub #139 Management Profile Photo Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Backend-authored profile-photo metadata to Management Attendance list/detail and Management Booking applicant rows, and consolidate Management User read projections onto the same canonical helper without changing its public API behavior.

**Architecture:** Keep Photo owned by User. One reusable explicit read-projection helper under `src/utils/` is consumed by Management User, Attendance, and Booking at their existing read boundaries; each feature keeps ownership of its surrounding response shape and business semantics. Photo upload/storage mutation remains explicit write-side logic and never depends on the read helper.

**Tech Stack:** Node.js ESM, Express 4, Sequelize 6, MySQL, Jest 29 with VM modules, OpenAPI YAML.

## Global Constraints

- Base branch: `develop`; implementation worktree base commit: `577793842c172018b3cb40c44853438d90c14c22`.
- Work only on `feature/gh-139-profile-photo-projection` in the isolated worktree.
- TDD is mandatory for new production behavior. Management User consolidation is a behavior-preserving refactor: first pin characterization behavior GREEN, then refactor while keeping those contracts GREEN.
- No new route, endpoint, request parameter, status code, or response envelope.
- No database migration or User/Photo association change.
- No photo upload, storage, deletion, URL signing, probing, caching, or fallback behavior.
- No global/default Sequelize scope that loads Photo implicitly.
- No per-row database query and no User-detail HTTP lookup.
- Attendance photo fields are exactly `user.photo` and `user.photo_updated_at` in list and detail.
- Booking applicant photo fields are exactly `user_photo` and `user_photo_updated_at`.
- Booking `processed_by` does not gain photo fields.
- Management User public fields remain exactly `photo` and `photo_updated_at` on list/detail/create/update response projections.
- Missing photo evidence produces explicit `null` values and never removes the parent row.
- Preserve Attendance search/filter/sort/pagination/detail semantics unchanged.
- Preserve Booking search/filter/order/pagination/approval/rejection/scoring semantics unchanged.
- Preserve Management User search/filter/sort/pagination, `404 E_NOT_FOUND`, `409 E_USER_LOCATION_INTEGRITY`, and photo upload/storage mutation semantics unchanged.
- Auth photo projection consolidation remains out of scope.

## Current Branch State

Tasks 1-4 already landed on this branch and are historical execution evidence; do not rerun their RED phases as if the code were absent. Their commits are:

```text
38f0792 feat(#139): add explicit user photo projection helper
e63c19a feat(#139): project profile photo in attendance reads
685867a feat(#139): project applicant photo in booking reads
014a86f docs(#139): publish management profile photo fields [contract tests]
20b9e24 docs(#139): publish management profile photo fields [OpenAPI]
65c7e9a test(#139): update booking controller model mocks
```

The remaining implementation work starts at Task 5. Task 6 must rerun fresh verification for the expanded scope.

---

## File Map

**Already created**

- `src/utils/userPhotoProjection.js` - canonical explicit Sequelize photo include descriptor plus null-safe photo metadata mapper.
- `tests/userPhotoProjection.test.js` - helper alias, selected attributes, optionality, persisted values, and null semantics.

**Modify - Management User consolidation**

- `src/controllers/user.controller.js` - replace four duplicated read/refetch Photo includes and two duplicated photo mappings with the canonical helper; keep write-side photo persistence explicit.
- `tests/userListProjectionContract.test.js` - pin nullable photo payload and optional list Photo join.
- `tests/userDetailProjectionContract.test.js` - pin nullable detail photo payload and optional detail Photo join while preserving 404/409 behavior.
- `tests/userCreateUpdateProjectionContract.test.js` - pin photo metadata on create/update response refetches.
- `tests/uploadUserPhotoController.test.js` - regression only; prove write-side storage/mutation remains independent of the read helper.

**Already modified - Attendance**

- `src/modules/attendance/attendance.query.js`
- `src/modules/attendance/attendance.mapper.js`
- `tests/attendanceManagementQuery.test.js`
- `tests/attendanceManagementMapper.test.js`
- `tests/attendanceManagementReadService.test.js`

**Already modified - Booking**

- `src/modules/booking/bookingManagement.query.js`
- `src/modules/booking/bookingManagement.mapper.js`
- `tests/bookingManagementQuery.test.js`
- `tests/bookingManagementMapper.test.js`
- booking controller/readiness model mocks touched only as compatibility tests require.

**Already modified - Public contract**

- `docs/openapi.yaml`
- `tests/attendanceManagementOpenApiContract.test.js`
- `tests/bookingManagementOpenApiContract.test.js`

### Task 1: Lock the shared explicit User photo projection primitive

**Files:**

- Create: `tests/userPhotoProjection.test.js`
- Create: `src/utils/userPhotoProjection.js`

**Interfaces:**

- Produces: `buildUserPhotoInclude(PhotoModel)` returning a Sequelize include object.
- Produces: `mapUserPhotoProjection(user)` returning `{ photo, photo_updated_at }`.
- Consumed by: Attendance query/mapper in Task 2, Booking query/mapper in Task 3, and Management User read projections in Task 5.

- [x] **Step 1: Write the failing helper contract test**

```js
import { buildUserPhotoInclude, mapUserPhotoProjection } from '../src/utils/userPhotoProjection.js';

const Photo = { modelName: 'Photo' };

test('builds the explicit optional photo_file include', () => {
  expect(buildUserPhotoInclude(Photo)).toEqual({
    model: Photo,
    as: 'photo_file',
    attributes: ['photo_url', 'photo_updated_at'],
    required: false
  });
});
test('maps persisted photo evidence without rewriting it', () => {
  const updatedAt = new Date('2026-08-10T08:30:00.000Z');
  expect(
    mapUserPhotoProjection({
      photo_file: {
        photo_url: 'https://cdn.example.com/users/7/profile/photo.jpg',
        photo_updated_at: updatedAt
      }
    })
  ).toEqual({
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

- [x] **Step 2: Run the helper test and verify RED**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/userPhotoProjection.test.js --runInBand`

Expected: FAIL because `src/utils/userPhotoProjection.js` does not exist.

- [x] **Step 3: Implement the minimal shared helper**

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

- [x] **Step 4: Run the helper test and verify GREEN**

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/userPhotoProjection.test.js --runInBand`

Expected: PASS with all helper tests green.

- [x] **Step 5: Commit the helper contract**

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

- [x] **Step 1: Write RED query assertions for the optional nested Photo join**

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
    model: Photo,
    as: 'photo_file',
    attributes: ['photo_url', 'photo_updated_at'],
    required: false
  });
  const searched = buildAttendanceListQuery({ page: 1, limit: 10, search: 'Andi' });
  expect(searched.include.find((item) => item.as === 'user').required).toBe(true);

  const detail = buildAttendanceDetailQuery();
  const detailUser = detail.include.find((item) => item.as === 'user');
  const detailPhoto = detailUser.include.find((item) => item.as === 'photo_file');
  expect(detailUser.required).toBe(false);
  expect(detailPhoto).toEqual({
    model: Photo,
    as: 'photo_file',
    attributes: ['photo_url', 'photo_updated_at'],
    required: false
  });
});
```

This test must not change the expected top-level include aliases, list `limit`/`offset`, or stable ordering assertions already present.

- [x] **Step 2: Extend Attendance mapper fixtures and expectations before production code**

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

- [x] **Step 3: Update the Attendance read-service test fixture/mocks and verify the suite is RED**

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

- [x] **Step 4: Implement the minimal Attendance query integration**

Change the model import to include `Photo`, and import the helper:

```js
import {
  AttendanceCategory,
  AttendanceStatus,
  Location,
  Photo,
  Role,
  User
} from '../../models/index.js';
import { buildUserPhotoInclude } from '../../utils/userPhotoProjection.js';
```

Change both existing User `include` arrays to contain Role plus the photo include:

```js
include: [
  { model: Role, as: 'role', attributes: ['role_name'], required: false },
  buildUserPhotoInclude(Photo)
];
```

Do not change `userInclude.required`, search predicates, parent User attributes, top-level includes, ordering, limit, offset, or `distinct`.

- [x] **Step 5: Implement the minimal Attendance mapper integration**

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

- [x] **Step 6: Run the focused Attendance tests and verify GREEN**

Run:

`node --experimental-vm-modules node_modules/jest/bin/jest.js tests/attendanceManagementQuery.test.js tests/attendanceManagementMapper.test.js tests/attendanceManagementReadService.test.js --runInBand`

Expected: PASS. Existing assertions for search-required User joins, detail fields, pagination, modes/statuses, location semantics, and ordering remain green.

- [x] **Step 7: Commit the Attendance projection**

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

- [x] **Step 1: Write RED Booking query assertions**

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
expect(applicant.include).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ model: Position, as: 'position' }),
    expect.objectContaining({ model: Role, as: 'role' }),
    {
      model: Photo,
      as: 'photo_file',
      attributes: ['photo_url', 'photo_updated_at'],
      required: false
    }
  ])
);
```

In the processor test, prove the photo include is absent:

```js
expect(processor.include.some((item) => item.as === 'photo_file')).toBe(false);
```

Keep the existing no-search applicant `required: false`, active-search `required: true`, wildcard escaping, fixed order, limit, offset, and `distinct` assertions unchanged.

- [x] **Step 2: Write RED Booking mapper assertions**

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

- [x] **Step 3: Run the focused Booking tests and verify RED**

Run:

`node --experimental-vm-modules node_modules/jest/bin/jest.js tests/bookingManagementQuery.test.js tests/bookingManagementMapper.test.js tests/bookingManagementReadService.test.js --runInBand`

Expected: query/mapper tests FAIL because applicant Photo is not yet included and mapped; read-service regression remains green or fails only because mapped fixture expectations were intentionally expanded.

- [x] **Step 4: Implement the minimal Booking query integration**

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
];
```

Do not modify `buildProcessorInclude`.

- [x] **Step 5: Implement the minimal Booking mapper integration**

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

- [x] **Step 6: Run the focused Booking tests and verify GREEN**

Run:

`node --experimental-vm-modules node_modules/jest/bin/jest.js tests/bookingManagementQuery.test.js tests/bookingManagementMapper.test.js tests/bookingManagementReadService.test.js --runInBand`

Expected: PASS with processor-photo exclusion and all existing ordering/search/pagination/scoring assertions still green.

- [x] **Step 7: Commit the Booking projection**

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

- [x] **Step 1: Write RED Attendance OpenAPI assertions**

Add:

```js
test('documents nullable profile photo evidence on attendance list and detail users', () => {
  const listUser = api.components.schemas.AttendanceAuditListRow.properties.user;
  const detailUser = api.components.schemas.AttendanceAuditDetail.properties.user;

  for (const user of [listUser, detailUser]) {
    expect(user.required).toEqual(expect.arrayContaining(['photo', 'photo_updated_at']));
    expect(user.properties.photo).toMatchObject({
      type: 'string',
      format: 'uri',
      nullable: true
    });
    expect(user.properties.photo_updated_at).toMatchObject({
      type: 'string',
      format: 'date-time',
      nullable: true
    });
  }
});
```

- [x] **Step 2: Write RED Booking OpenAPI assertions**

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

- [x] **Step 3: Run only the two OpenAPI tests and verify RED**

Run:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/attendanceManagementOpenApiContract.test.js tests/bookingManagementOpenApiContract.test.js --runInBand
```

Expected: FAIL because the four new schema properties are not yet documented.

- [x] **Step 4: Update the Attendance OpenAPI user schemas**

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

- [x] **Step 5: Update `BookingManagementItem` only**

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

- [x] **Step 6: Run the OpenAPI contract tests and verify GREEN**

Run:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/attendanceManagementOpenApiContract.test.js tests/bookingManagementOpenApiContract.test.js tests/clientCriticalOpenApiContract.test.js --runInBand
```

Expected: PASS. The client-critical OpenAPI regression must remain green.

- [x] **Step 7: Commit the public contract**

```powershell
git add -- docs/openapi.yaml tests/attendanceManagementOpenApiContract.test.js tests/bookingManagementOpenApiContract.test.js
git commit -m "docs(#139): publish management profile photo fields"
```

---

### Task 5: Consolidate Management User onto the canonical photo read projection

**Files:**

- Modify: `tests/userListProjectionContract.test.js`
- Modify: `tests/userDetailProjectionContract.test.js`
- Modify: `tests/userCreateUpdateProjectionContract.test.js`
- Modify: `src/controllers/user.controller.js`
- Regression: `tests/uploadUserPhotoController.test.js`
- Regression: `tests/usersListPaginationContract.test.js`
- Regression: `tests/usersPayloadContract.test.js`

**Interfaces:**

- Consumes: `buildUserPhotoInclude(PhotoModel)` and `mapUserPhotoProjection(user)` from Task 1.
- Produces: no new public API fields; existing Management User `photo` / `photo_updated_at` payloads remain byte-for-byte semantically compatible.
- Keeps: User list/detail/create/update ownership in `user.controller.js`; upload/storage/delete mutation remains explicit write-side logic.

This task is a pure refactor. Do not invent a failing behavior test merely to force RED; first establish characterization tests on the current implementation, then refactor while keeping them GREEN.

- [ ] **Step 1: Add list characterization for nullable photo evidence and optional join**

Add to `tests/userListProjectionContract.test.js`:

```js
test('list keeps nullable photo evidence and an optional photo_file join', async () => {
  const findAll = jest.fn().mockResolvedValue([buildUser({ photo_file: null })]);
  const { getAllUsers } = await loadController({ findAll });

  const res = buildRes();
  await getAllUsers({ query: {} }, res, jest.fn());

  expect(res.json.mock.calls[0][0].data[0]).toMatchObject({
    photo: null,
    photo_updated_at: null
  });

  const include = findAll.mock.calls[0][0].include;
  const photoInclude = include.find((entry) => entry.as === 'photo_file');
  expect(photoInclude).toMatchObject({
    as: 'photo_file',
    attributes: ['photo_url', 'photo_updated_at'],
    required: false
  });
});
```

- [ ] **Step 2: Add detail characterization without weakening 404/409 integrity tests**

Add to `tests/userDetailProjectionContract.test.js`:

```js
test('detail keeps nullable photo evidence and an optional photo_file join', async () => {
  const findOne = jest.fn().mockResolvedValue(buildUser({ photo_file: null }));
  const { getUserById } = await loadController({ findOne });

  const res = buildRes();
  await getUserById({ params: { id: '5' }, user: { id: 1 } }, res, jest.fn());

  expect(res.json.mock.calls[0][0].data).toMatchObject({
    photo: null,
    photo_updated_at: null
  });

  const include = findOne.mock.calls[0][0].include;
  expect(include.find((entry) => entry.as === 'photo_file')).toMatchObject({
    attributes: ['photo_url', 'photo_updated_at'],
    required: false
  });
});
```

Keep the existing `404 E_NOT_FOUND` and `409 E_USER_LOCATION_INTEGRITY` tests unchanged.

- [ ] **Step 3: Pin create/update response photo metadata before refactoring**

In the existing create response test in `tests/userCreateUpdateProjectionContract.test.js`, add:

```js
expect(payload.data.photo).toBe('https://cdn.example.com/cindy.jpg');
expect(payload.data.photo_updated_at).toEqual(new Date('2026-07-05T00:00:00.000Z'));
```

Add the same two assertions to the existing update response test after reading its `payload`.

- [ ] **Step 4: Run the Management User characterization suite and verify GREEN before refactor**

Run:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/userListProjectionContract.test.js tests/userDetailProjectionContract.test.js tests/userCreateUpdateProjectionContract.test.js --runInBand
```

Expected: PASS on the pre-refactor implementation. This proves the task changes architecture, not behavior.

- [ ] **Step 5: Replace duplicated read projection code with the canonical helper**

In `src/controllers/user.controller.js`, import:

```js
import { buildUserPhotoInclude, mapUserPhotoProjection } from '../utils/userPhotoProjection.js';
```

Replace the two projection pairs:

```js
photo: user.photo_file ? user.photo_file.photo_url : null,
photo_updated_at: user.photo_file ? user.photo_file.photo_updated_at : null,
```

with:

```js
...mapUserPhotoProjection(user),
```

Do this once in `toUserDetailProjection` and once in `toUserListProjection` only.

Replace each of the four read/refetch include objects:

```js
{
  model: Photo,
  as: 'photo_file',
  attributes: ['photo_url', 'photo_updated_at'],
  required: false
}
```

with:

```js
buildUserPhotoInclude(Photo);
```

The four bounded locations are `GET /users`, update response refetch, create response refetch, and `GET /users/:id`.

Do not modify `uploadUserPhoto`, Photo row create/update payloads, Spaces cleanup, Cloudinary cleanup, or `User.id_photos` synchronization.

- [ ] **Step 6: Run focused Management User contracts after refactor**

Run:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/userPhotoProjection.test.js tests/userListProjectionContract.test.js tests/userDetailProjectionContract.test.js tests/userCreateUpdateProjectionContract.test.js --runInBand
```

Expected: PASS with identical public photo values and null semantics.

- [ ] **Step 7: Prove write-side and directory behavior remain unchanged**

Run:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/uploadUserPhotoController.test.js tests/usersListPaginationContract.test.js tests/usersPayloadContract.test.js tests/usersListSortContract.test.js --runInBand
```

Expected: PASS. No upload/storage test may require or mock the read projection helper.

- [ ] **Step 8: Verify the duplicate read implementation is actually gone**

Run:

```powershell
$controller = 'src/controllers/user.controller.js'
$manualPatterns = @(
  'photo:\s*user\.photo_file\s*\?',
  'photo_updated_at:\s*user\.photo_file\s*\?',
  "attributes:\s*\['photo_url', 'photo_updated_at'\]"
)
foreach ($pattern in $manualPatterns) {
  if (Select-String -Path $controller -Pattern $pattern) {
    throw "Duplicate manual photo projection remains: $pattern"
  }
}
if ((Select-String -Path $controller -Pattern 'buildUserPhotoInclude\(Photo\)').Count -ne 4) {
  throw 'Expected exactly four Management User read/refetch photo includes'
}
if ((Select-String -Path $controller -Pattern 'mapUserPhotoProjection\(user\)').Count -ne 2) {
  throw 'Expected exactly two Management User photo mapping call sites'
}
```

Expected: command completes without throwing. This is an architecture check, not a replacement for behavior tests.

- [ ] **Step 9: Commit the bounded Management User consolidation**

```powershell
git add -- src/controllers/user.controller.js tests/userListProjectionContract.test.js tests/userDetailProjectionContract.test.js tests/userCreateUpdateProjectionContract.test.js
git commit -m "refactor(#139): consolidate user photo read projection"
```

Do not stage unrelated files from the main checkout or Auth controller.

---

### Task 6: Cross-feature regression and completion verification

**Files:**

- No new production behavior.
- Modify only a file already listed above if fresh verification proves a scoped #139 defect.

**Interfaces:**

- Produces fresh evidence that the shared photo projection does not change adjacent Management User, Attendance, Booking, OpenAPI, architecture, upload/storage, or lint behavior.

- [ ] **Step 1: Run the focused cross-feature contract suite**

Run:

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/userPhotoProjection.test.js tests/userListProjectionContract.test.js tests/userDetailProjectionContract.test.js tests/userCreateUpdateProjectionContract.test.js tests/uploadUserPhotoController.test.js tests/usersListPaginationContract.test.js tests/usersPayloadContract.test.js tests/attendanceManagementQuery.test.js tests/attendanceManagementMapper.test.js tests/attendanceManagementReadService.test.js tests/attendanceManagementOpenApiContract.test.js tests/bookingManagementQuery.test.js tests/bookingManagementMapper.test.js tests/bookingManagementReadService.test.js tests/bookingManagementOpenApiContract.test.js tests/clientCriticalOpenApiContract.test.js tests/architectureLayerRules.test.js --runInBand
```

Expected: all listed suites pass with zero failures. User upload/storage regression remains green while the read helper is shared by three management surfaces.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: exit code `0` with no ESLint errors.

- [ ] **Step 3: Run the complete non-integration Jest baseline**

Run: `npm test -- --runInBand`

Expected: all suites/tests pass. Record fresh counts; do not reuse the original `146 suites / 1426 tests` baseline or any earlier branch run as completion evidence.

- [ ] **Step 4: Verify whitespace and exact diff scope**

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
src/controllers/user.controller.js
src/modules/attendance/attendance.query.js
src/modules/attendance/attendance.mapper.js
src/modules/booking/bookingManagement.query.js
src/modules/booking/bookingManagement.mapper.js
docs/openapi.yaml
focused User/Attendance/Booking/OpenAPI tests named in Tasks 1-5
spec/plan documentation commits
```

The diff must not contain migrations, route files, `src/controllers/auth.controller.js`, attendance mutations/jobs, booking mutations, WFA scoring, storage config, Docker files, or Web FE files. `src/controllers/user.controller.js` is allowed only for the bounded read/refetch consolidation from Task 5.

- [ ] **Step 5: Verify authenticated runtime contract when access already exists**

For a Management/Admin session, inspect User, Attendance, and Booking read surfaces using one user with a linked photo and one user without one. Confirm:

```text
GET /api/users                 -> photo/photo_updated_at present or explicit null
GET /api/users/:id             -> same canonical User photo fields
GET /api/attendance            -> user.photo/user.photo_updated_at
GET /api/bookings              -> user_photo/user_photo_updated_at
missing photo on any surface   -> explicit nulls; parent row remains present
```

Also confirm User pagination/counts and Attendance/Booking pagination remain consistent with the same requests before consolidation. If no authenticated runtime session is already available, do not invent credentials or claim runtime evidence; record `Runtime evidence: Needs Verification` in the PR handoff.

- [ ] **Step 6: Review commit history and remaining requirement coverage**

Run:

```powershell
git log --oneline refs/remotes/origin/develop..HEAD
```

Existing implementation history must include the helper, Attendance projection, Booking projection, OpenAPI contract, compatibility mocks, and revised design. After Task 5, it must additionally include:

```text
refactor(#139): consolidate user photo read projection
```

Do not create a verification-only commit unless verification exposes and fixes a scoped defect.

## Completion Checklist

Before calling GitHub #139 implementation-ready for PR:

- [ ] shared include selects only `photo_url` and `photo_updated_at` and is always optional;
- [ ] shared mapper returns persisted evidence unchanged and explicit nulls when absent;
- [ ] Management User list/detail/create/update response refetches use the canonical helper without changing `photo` / `photo_updated_at` payloads;
- [ ] Management User list pagination/search/sort and detail `404 E_NOT_FOUND` / `409 E_USER_LOCATION_INTEGRITY` behavior remain unchanged;
- [ ] Management User photo upload/storage/delete mutation remains explicit and independent of the read helper;
- [ ] Attendance list and detail both expose `user.photo` and `user.photo_updated_at`;
- [ ] Attendance search-required User behavior and pagination remain unchanged;
- [ ] Booking applicant exposes `user_photo` and `user_photo_updated_at`;
- [ ] Booking processor has no photo include/fields;
- [ ] Booking ordering/search/filter/pagination/scoring/reason behavior remains unchanged;
- [ ] OpenAPI matches the Attendance and Booking nullable fields exactly; User OpenAPI contract is unchanged;
- [ ] no route, migration, storage, scheduler, Auth, or unrelated controller/mutation file enters the diff;
- [ ] focused tests, lint, full Jest suite, and `git diff --check` have fresh passing evidence;
- [ ] runtime evidence covers User/Attendance/Booking truthfully or is explicitly marked `Needs Verification`.
