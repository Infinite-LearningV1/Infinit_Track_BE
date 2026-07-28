# INF-267 Management Attendance Query and Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the validated, server-driven Management Attendance list query and a separate audit-detail endpoint defined by INF-267.

**Architecture:** Keep the existing attendance route mount and public controller exports, but delegate list/detail reads to a bounded `src/modules/attendance/` validation-query-mapper-service slice. The query object owns every Sequelize field and association allowlist; the mapper owns the public payload; the legacy controller remains HTTP-only for these two reads.

**Tech Stack:** Node.js ESM, Express 4, express-validator, Sequelize 6, MySQL, Jest ESM, Supertest, OpenAPI YAML.

## Global Constraints

- Work only in `E:\test\Infinit_Track_BE\.worktrees\inf-267-attendance-query-detail` on `codex/inf-267-attendance-query-detail`.
- Preserve `GET /api/attendance` pagination keys: `current_page`, `total_pages`, `total_records`, `records_per_page`, `has_next_page`, `has_prev_page`.
- Defaults are `page=1`, `limit=10`; maximum `limit` is `100`.
- Search fields are exactly `full_name`, `nip_nim`, and `email`; escape `\\`, `%`, and `_` before `LIKE`.
- Public mode keys are `wfo`, `wfh`, `wfa`; public status keys are `ontime`, `late`, `alpha`, `early`.
- Public sort keys are `attendance_date`, `time_in`, `time_out`, `full_name`, `status`, `created_at`.
- Default order is `attendance_date DESC`, `time_in DESC`, `id_attendance DESC`; explicit sorts end with `id_attendance DESC`.
- List rows do not contain email, notes, booking ID, coordinates, or radius.
- Detail uses only the attendance row's linked location; never substitute a user WFH profile location.
- Admin and Management may list/detail/delete; plain User may not. Existing hard delete remains unchanged.
- Use WIB-preserving existing time-format utilities and represent absent time/duration values as `null`, not a fabricated `00:00`.
- Do not edit check-in, checkout, scheduler/job, analytics, report, or mutation behavior.

---

### Task 1: Attendance Query Validation

**Files:**
- Create: `src/modules/attendance/attendance.validation.js`
- Create: `tests/attendanceManagementQueryValidation.test.js`

**Interfaces:**
- Produces: `ATTENDANCE_LIST_QUERY_KEYS`, `ATTENDANCE_SORT_KEYS`, `validateAttendanceListQuery`, and `validateAttendanceId`.
- Consumes later: `src/routes/attendance.routes.js` mounts these arrays immediately before the shared `validate` middleware.

- [ ] **Step 1: Write the failing validation contract test**

```js
import express from 'express';
import request from 'supertest';

import {
  validateAttendanceId,
  validateAttendanceListQuery
} from '../src/modules/attendance/attendance.validation.js';
import { validate } from '../src/middlewares/validator.js';

const app = express();
app.get('/attendance', validateAttendanceListQuery, validate, (req, res) =>
  res.json({ query: req.query })
);
app.get('/attendance/:id', validateAttendanceId, validate, (req, res) =>
  res.json({ id: req.params.id })
);

test('normalizes the complete valid attendance query', async () => {
  const response = await request(app).get('/attendance').query({
    page: '2', limit: '20', search: '  andi@example.com  ',
    from: '2026-07-01', to: '2026-07-31', mode: 'wfh', status: 'late',
    checkout_state: 'completed', sortBy: 'full_name', sortOrder: 'asc'
  });
  expect(response.status).toBe(200);
  expect(response.body.query).toMatchObject({
    page: 2, limit: 20, search: 'andi@example.com', sortOrder: 'ASC'
  });
});

test.each([
  ['page non-numeric', '/attendance?page=abc'],
  ['limit over maximum', '/attendance?limit=101'],
  ['impossible from date', '/attendance?from=2026-02-30'],
  ['reversed range', '/attendance?from=2026-07-31&to=2026-07-01'],
  ['invalid mode', '/attendance?mode=hybrid'],
  ['invalid status', '/attendance?status=present'],
  ['invalid checkout state', '/attendance?checkout_state=closed'],
  ['unsupported sort key', '/attendance?sortBy=id_attendance'],
  ['invalid sort order', '/attendance?sortOrder=sideways'],
  ['array value', '/attendance?page=1&page=2'],
  ['object-shaped key', '/attendance?page[x]=1'],
  ['unknown key', '/attendance?user_id=7']
])('returns 400 E_VALIDATION for %s', async (_label, path) => {
  const response = await request(app).get(path);
  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({ success: false, code: 'E_VALIDATION' });
});

test.each(['/attendance/0', '/attendance/abc'])('rejects invalid detail ID %s', async (path) => {
  const response = await request(app).get(path);
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('E_VALIDATION');
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- tests/attendanceManagementQueryValidation.test.js --runInBand`

Expected: FAIL because `src/modules/attendance/attendance.validation.js` does not exist.

- [ ] **Step 3: Implement strict scalar/date/enum validation**

```js
import { param, query } from 'express-validator';

export const ATTENDANCE_LIST_QUERY_KEYS = [
  'page', 'limit', 'search', 'from', 'to', 'mode', 'status',
  'checkout_state', 'sortBy', 'sortOrder'
];
export const ATTENDANCE_SORT_KEYS = [
  'attendance_date', 'time_in', 'time_out', 'full_name', 'status', 'created_at'
];

const strictDateOnly = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
};

const rejectUnknownKeys = query().custom((_value, { req }) => {
  const invalid = Object.keys(req.query ?? {}).find(
    (key) => !ATTENDANCE_LIST_QUERY_KEYS.includes(key)
  );
  if (invalid) throw new Error(`Query parameter tidak didukung: ${invalid}`);
  return true;
});

export const validateAttendanceListQuery = [
  rejectUnknownKeys,
  query('page').default(1).isInt({ min: 1 }).withMessage('page harus bilangan bulat >= 1').toInt(),
  query('limit').default(10).isInt({ min: 1, max: 100 }).withMessage('limit harus bilangan bulat 1-100').toInt(),
  query('search').optional().isString().withMessage('search harus berupa teks').trim(),
  query('from').optional().isString().withMessage('from harus berupa teks')
    .custom(strictDateOnly).withMessage('from harus tanggal valid YYYY-MM-DD'),
  query('to').optional().isString().withMessage('to harus berupa teks')
    .custom(strictDateOnly).withMessage('to harus tanggal valid YYYY-MM-DD')
    .custom((value, { req }) => !req.query.from || req.query.from <= value)
    .withMessage('to tidak boleh sebelum from'),
  query('mode').optional().isString().isIn(['wfo', 'wfh', 'wfa'])
    .withMessage('mode harus wfo, wfh, atau wfa'),
  query('status').optional().isString().isIn(['ontime', 'late', 'alpha', 'early'])
    .withMessage('status harus ontime, late, alpha, atau early'),
  query('checkout_state').optional().isString().isIn(['completed', 'open'])
    .withMessage('checkout_state harus completed atau open'),
  query('sortBy').optional().isString().isIn(ATTENDANCE_SORT_KEYS)
    .withMessage(`sortBy harus salah satu dari: ${ATTENDANCE_SORT_KEYS.join(', ')}`),
  query('sortOrder').optional().isString().withMessage('sortOrder harus berupa teks')
    .customSanitizer((value) => typeof value === 'string' ? value.toUpperCase() : value)
    .isIn(['ASC', 'DESC']).withMessage('sortOrder harus ASC atau DESC')
];

export const validateAttendanceId = [
  param('id').isInt({ min: 1 }).withMessage('id harus bilangan bulat >= 1').toInt()
];
```

- [ ] **Step 4: Run validation tests and verify GREEN**

Run: `npm test -- tests/attendanceManagementQueryValidation.test.js --runInBand`

Expected: PASS; the valid request is normalized and every malformed shape returns `400 E_VALIDATION`.

- [ ] **Step 5: Commit validation**

```powershell
git add -- src/modules/attendance/attendance.validation.js tests/attendanceManagementQueryValidation.test.js
git commit -m "feat(inf-267): validate attendance management queries"
```

---

### Task 2: Allowlisted Sequelize Query Builder

**Files:**
- Create: `src/modules/attendance/attendance.query.js`
- Create: `tests/attendanceManagementQuery.test.js`

**Interfaces:**
- Produces: `escapeAttendanceLike`, `buildAttendanceListQuery(query)`, and `buildAttendanceDetailQuery()`.
- `buildAttendanceListQuery` returns one Sequelize options object containing `attributes`, `where`, `include`, `order`, `limit`, `offset`, and `distinct`.
- Consumed by: `attendanceRead.service.js` in Task 4.

- [ ] **Step 1: Write failing query behavior tests**

```js
import { Op } from 'sequelize';
import { AttendanceStatus, User } from '../src/models/index.js';
import {
  buildAttendanceListQuery,
  escapeAttendanceLike
} from '../src/modules/attendance/attendance.query.js';

test('escapes LIKE wildcard characters literally', () => {
  expect(escapeAttendanceLike(String.raw`A_100%\done`)).toBe(String.raw`A\_100\%\\done`);
});

test('combines date, mode, status, checkout, search, and pagination in one graph', () => {
  const options = buildAttendanceListQuery({
    page: 3, limit: 20, search: '100%', from: '2026-07-01', to: '2026-07-31',
    mode: 'wfh', status: 'late', checkout_state: 'completed'
  });
  expect(options.limit).toBe(20);
  expect(options.offset).toBe(40);
  expect(options.distinct).toBe(true);
  expect(options.where).toMatchObject({ category_id: 2, status_id: 2 });
  expect(options.where.attendance_date[Op.between]).toEqual(['2026-07-01', '2026-07-31']);
  expect(options.where.time_out[Op.not]).toBeNull();
  const userInclude = options.include.find((item) => item.as === 'user');
  expect(userInclude.required).toBe(true);
  expect(userInclude.where[Op.or][0].full_name[Op.like]).toBe(String.raw`%100\%%`);
});

test('uses the three-column stable default order', () => {
  expect(buildAttendanceListQuery({ page: 1, limit: 10 }).order).toEqual([
    ['attendance_date', 'DESC'], ['time_in', 'DESC'], ['id_attendance', 'DESC']
  ]);
});

test('maps joined sort keys and keeps the stable tie-breaker', () => {
  expect(buildAttendanceListQuery({
    page: 1, limit: 10, sortBy: 'full_name', sortOrder: 'ASC'
  }).order).toEqual([
    [{ model: User, as: 'user' }, 'full_name', 'ASC'], ['id_attendance', 'DESC']
  ]);
  expect(buildAttendanceListQuery({
    page: 1, limit: 10, sortBy: 'status', sortOrder: 'DESC'
  }).order[0]).toEqual([
    { model: AttendanceStatus, as: 'status' }, 'attendance_status_name', 'DESC'
  ]);
});
```

- [ ] **Step 2: Run query tests and verify RED**

Run: `npm test -- tests/attendanceManagementQuery.test.js --runInBand`

Expected: FAIL because the query module does not exist.

- [ ] **Step 3: Implement the query and sort allowlists**

```js
import { Op } from 'sequelize';
import {
  AttendanceCategory, AttendanceStatus, Location, Role, User
} from '../../models/index.js';

const MODE_IDS = { wfo: 1, wfh: 2, wfa: 3 };
const STATUS_IDS = { ontime: 1, late: 2, alpha: 3, early: 4 };
const DIRECT_SORTS = new Set(['attendance_date', 'time_in', 'time_out', 'created_at']);

export const escapeAttendanceLike = (value) => value.replace(/[\\%_]/g, '\\$&');

const buildOrder = ({ sortBy, sortOrder = 'DESC' }) => {
  if (!sortBy) return [['attendance_date', 'DESC'], ['time_in', 'DESC'], ['id_attendance', 'DESC']];
  const direction = sortOrder === 'ASC' ? 'ASC' : 'DESC';
  if (DIRECT_SORTS.has(sortBy)) return [[sortBy, direction], ['id_attendance', 'DESC']];
  if (sortBy === 'full_name') {
    return [[{ model: User, as: 'user' }, 'full_name', direction], ['id_attendance', 'DESC']];
  }
  if (sortBy === 'status') {
    return [[{ model: AttendanceStatus, as: 'status' }, 'attendance_status_name', direction], ['id_attendance', 'DESC']];
  }
  return [['attendance_date', 'DESC'], ['time_in', 'DESC'], ['id_attendance', 'DESC']];
};

export const buildAttendanceListQuery = (query = {}) => {
  const { page = 1, limit = 10, search, from, to, mode, status, checkout_state } = query;
  const where = {};
  if (from && to) where.attendance_date = { [Op.between]: [from, to] };
  else if (from) where.attendance_date = { [Op.gte]: from };
  else if (to) where.attendance_date = { [Op.lte]: to };
  if (mode) where.category_id = MODE_IDS[mode];
  if (status) where.status_id = STATUS_IDS[status];
  if (checkout_state === 'completed') where.time_out = { [Op.not]: null };
  if (checkout_state === 'open') where.time_out = { [Op.is]: null };

  const term = typeof search === 'string' ? search.trim() : '';
  const like = term ? `%${escapeAttendanceLike(term)}%` : null;
  const userInclude = {
    model: User, as: 'user', attributes: ['id_users', 'full_name', 'nip_nim'],
    required: Boolean(like),
    include: [{ model: Role, as: 'role', attributes: ['role_name'], required: false }]
  };
  if (like) userInclude.where = { [Op.or]: [
    { full_name: { [Op.like]: like } },
    { nip_nim: { [Op.like]: like } },
    { email: { [Op.like]: like } }
  ] };

  return {
    attributes: ['id_attendance', 'attendance_date', 'time_in', 'time_out', 'work_hour', 'category_id', 'status_id', 'location_id'],
    where,
    include: [
      userInclude,
      { model: Location, as: 'location', attributes: ['location_id', 'description'], required: false },
      { model: AttendanceStatus, as: 'status', attributes: ['attendance_status_name'], required: false },
      { model: AttendanceCategory, as: 'attendance_category', attributes: ['category_name'], required: false }
    ],
    order: buildOrder(query), limit, offset: (page - 1) * limit, distinct: true
  };
};

export const buildAttendanceDetailQuery = () => ({
  attributes: ['id_attendance', 'attendance_date', 'time_in', 'time_out', 'work_hour', 'category_id', 'status_id', 'notes', 'booking_id', 'location_id'],
  include: [
    { model: User, as: 'user', attributes: ['id_users', 'full_name', 'nip_nim', 'email'], required: false,
      include: [{ model: Role, as: 'role', attributes: ['role_name'], required: false }] },
    { model: Location, as: 'location', attributes: ['location_id', 'description', 'latitude', 'longitude', 'radius'], required: false },
    { model: AttendanceStatus, as: 'status', attributes: ['attendance_status_name'], required: false },
    { model: AttendanceCategory, as: 'attendance_category', attributes: ['category_name'], required: false }
  ]
});
```

- [ ] **Step 4: Add literal tests for every mode/status/date/order branch and verify GREEN**

```js
test.each([['wfo', 1], ['wfh', 2], ['wfa', 3]])('maps mode %s to category %i', (mode, id) => {
  expect(buildAttendanceListQuery({ page: 1, limit: 10, mode }).where.category_id).toBe(id);
});
test.each([['ontime', 1], ['late', 2], ['alpha', 3], ['early', 4]])(
  'maps status %s to status ID %i',
  (status, id) => {
    expect(buildAttendanceListQuery({ page: 1, limit: 10, status }).where.status_id).toBe(id);
  }
);
test('maps one-sided dates and open checkout', () => {
  expect(buildAttendanceListQuery({ page: 1, limit: 10, from: '2026-07-01' })
    .where.attendance_date[Op.gte]).toBe('2026-07-01');
  expect(buildAttendanceListQuery({ page: 1, limit: 10, to: '2026-07-31' })
    .where.attendance_date[Op.lte]).toBe('2026-07-31');
  expect(buildAttendanceListQuery({ page: 1, limit: 10, checkout_state: 'open' })
    .where.time_out[Op.is]).toBeNull();
});
test.each(['attendance_date', 'time_in', 'time_out', 'created_at'])(
  'maps direct sort %s without accepting an arbitrary column',
  (sortBy) => {
    expect(buildAttendanceListQuery({ page: 1, limit: 10, sortBy, sortOrder: 'ASC' }).order)
      .toEqual([[sortBy, 'ASC'], ['id_attendance', 'DESC']]);
  }
);
```

Run: `npm test -- tests/attendanceManagementQuery.test.js --runInBand`

Expected: PASS with every public key mapped to a literal expected Sequelize target.

- [ ] **Step 5: Commit the query builder**

```powershell
git add -- src/modules/attendance/attendance.query.js tests/attendanceManagementQuery.test.js
git commit -m "feat(inf-267): build attendance audit queries"
```

---

### Task 3: Slim List and Full Detail Mappers

**Files:**
- Create: `src/modules/attendance/attendance.mapper.js`
- Create: `tests/attendanceManagementMapper.test.js`

**Interfaces:**
- Produces: `mapAttendanceListRow(row)` and `mapAttendanceDetail(row)`.
- Both return plain JSON-safe objects; neither returns an ORM instance.
- Consumed by: `attendanceRead.service.js` in Task 4.

- [ ] **Step 1: Write failing projection tests using complete row fixtures**

```js
import {
  mapAttendanceDetail,
  mapAttendanceListRow
} from '../src/modules/attendance/attendance.mapper.js';

const row = {
  id_attendance: 42, attendance_date: '2026-07-28',
  time_in: new Date(2026, 6, 28, 8, 2), time_out: new Date(2026, 6, 28, 17, 5),
  work_hour: 9.05, category_id: 1, status_id: 1, notes: 'Verified', booking_id: 55,
  user: { id_users: 7, full_name: 'Andi Saputra', nip_nim: 'EMP-007', email: 'andi@example.com', role: { role_name: 'User' } },
  attendance_category: { category_name: 'Work From Office' },
  status: { attendance_status_name: 'Tepat Waktu' },
  location: { location_id: 1, description: 'Palu Office', latitude: '-0.900291', longitude: '119.877998', radius: '100' }
};

test('maps only audit-table fields in the list row', () => {
  const result = mapAttendanceListRow(row);
  expect(result).toEqual({
    id_attendance: 42, attendance_date: '2026-07-28',
    user: { id: 7, full_name: 'Andi Saputra', nip_nim: 'EMP-007', role: 'User' },
    time_in: '08:02', time_out: '17:05', work_duration: '09:03',
    mode: { key: 'wfo', label: 'WFO' },
    status: { key: 'ontime', label: 'On Time' },
    location: { available: true, id: 1, description: 'Palu Office' }
  });
  expect(result.user).not.toHaveProperty('email');
  expect(result.location).not.toHaveProperty('latitude');
  expect(result).not.toHaveProperty('notes');
});

test('maps full detail and converts coordinates to numbers', () => {
  expect(mapAttendanceDetail(row)).toMatchObject({
    notes: 'Verified', booking_id: 55,
    user: { email: 'andi@example.com' },
    location: { id: 1, latitude: -0.900291, longitude: 119.877998, radius: 100 }
  });
});

test('does not fabricate time, duration, or location', () => {
  const result = mapAttendanceDetail({ ...row, time_out: null, work_hour: null, location: null });
  expect(result.time_out).toBeNull();
  expect(result.work_duration).toBeNull();
  expect(result.location).toBeNull();
});
```

- [ ] **Step 2: Run mapper tests and verify RED**

Run: `npm test -- tests/attendanceManagementMapper.test.js --runInBand`

Expected: FAIL because the mapper module does not exist.

- [ ] **Step 3: Implement canonical mapping and null handling**

```js
import { formatTimeOnly, formatWorkHour } from '../../utils/workHourFormatter.js';

const MODES = {
  1: { key: 'wfo', label: 'WFO' }, 2: { key: 'wfh', label: 'WFH' },
  3: { key: 'wfa', label: 'WFA' }
};
const STATUSES = {
  1: { key: 'ontime', label: 'On Time' }, 2: { key: 'late', label: 'Late' },
  3: { key: 'alpha', label: 'Alpha' }, 4: { key: 'early', label: 'Early' }
};
const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const timeOrNull = (value) => value ? formatTimeOnly(value) : null;
const durationOrNull = (value) => value === null || value === undefined ? null : formatWorkHour(value);
const modeOf = (row) => MODES[row.category_id] ?? { key: null, label: row.attendance_category?.category_name ?? null };
const statusOf = (row) => STATUSES[row.status_id] ?? { key: null, label: row.status?.attendance_status_name ?? null };
const userOf = (row, includeEmail = false) => ({
  id: row.user?.id_users ?? null,
  full_name: row.user?.full_name ?? null,
  nip_nim: row.user?.nip_nim ?? null,
  ...(includeEmail ? { email: row.user?.email ?? null } : {}),
  role: row.user?.role?.role_name ?? null
});

export const mapAttendanceListRow = (row) => ({
  id_attendance: row.id_attendance,
  attendance_date: row.attendance_date,
  user: userOf(row),
  time_in: timeOrNull(row.time_in),
  time_out: timeOrNull(row.time_out),
  work_duration: durationOrNull(row.work_hour),
  mode: modeOf(row),
  status: statusOf(row),
  location: row.location ? {
    available: true, id: row.location.location_id, description: row.location.description ?? null
  } : { available: false, id: null, description: null }
});

export const mapAttendanceDetail = (row) => ({
  id_attendance: row.id_attendance,
  attendance_date: row.attendance_date,
  time_in: timeOrNull(row.time_in),
  time_out: timeOrNull(row.time_out),
  work_duration: durationOrNull(row.work_hour),
  mode: modeOf(row), status: statusOf(row),
  notes: row.notes ?? '', booking_id: row.booking_id ?? null,
  user: userOf(row, true),
  location: row.location ? {
    id: row.location.location_id, description: row.location.description ?? null,
    latitude: numberOrNull(row.location.latitude), longitude: numberOrNull(row.location.longitude),
    radius: numberOrNull(row.location.radius)
  } : null
});
```

- [ ] **Step 4: Add mapping cases for WFH/WFA/late/alpha/early and verify GREEN**

```js
test.each([
  [2, { key: 'wfh', label: 'WFH' }],
  [3, { key: 'wfa', label: 'WFA' }]
])('maps category ID %i', (categoryId, expected) => {
  expect(mapAttendanceListRow({ ...row, category_id: categoryId }).mode).toEqual(expected);
});
test.each([
  [2, { key: 'late', label: 'Late' }],
  [3, { key: 'alpha', label: 'Alpha' }],
  [4, { key: 'early', label: 'Early' }]
])('maps status ID %i', (statusId, expected) => {
  expect(mapAttendanceListRow({ ...row, status_id: statusId }).status).toEqual(expected);
});
test('keeps unknown database labels without inventing canonical keys', () => {
  const result = mapAttendanceListRow({
    ...row, category_id: 99, status_id: 99,
    attendance_category: { category_name: 'Field Work' },
    status: { attendance_status_name: 'Reviewed' }, user: null
  });
  expect(result.mode).toEqual({ key: null, label: 'Field Work' });
  expect(result.status).toEqual({ key: null, label: 'Reviewed' });
  expect(result.user).toEqual({ id: null, full_name: null, nip_nim: null, role: null });
});
```

Run: `npm test -- tests/attendanceManagementMapper.test.js --runInBand`

Expected: PASS; list data is slim and detail data is truthful.

- [ ] **Step 5: Commit mappers**

```powershell
git add -- src/modules/attendance/attendance.mapper.js tests/attendanceManagementMapper.test.js
git commit -m "feat(inf-267): map attendance list and detail payloads"
```

---

### Task 4: Read Service and Thin HTTP Controllers

**Files:**
- Create: `src/modules/attendance/attendanceRead.service.js`
- Create: `tests/attendanceManagementReadService.test.js`
- Create: `tests/attendanceManagementController.test.js`
- Modify: `src/controllers/attendance.controller.js:1-35,1623-1736`
- Modify: `tests/attendanceReadsContract.test.js:1-268`

**Interfaces:**
- Produces: `listManagementAttendances(query)` returning `{ data, pagination }`.
- Produces: `getManagementAttendanceDetail(id)` returning a mapped detail object or `null`.
- Controller exports remain `getAllAttendances(req,res,next)` and new `getAttendanceDetail(req,res,next)`.

- [ ] **Step 1: Write failing service tests**

```js
import { jest } from '@jest/globals';

const findAndCountAll = jest.fn();
const findByPk = jest.fn();
jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: { findAndCountAll, findByPk }, User: {}, Role: {}, Location: {},
  AttendanceStatus: {}, AttendanceCategory: {}
}));

const { getManagementAttendanceDetail, listManagementAttendances } =
  await import('../src/modules/attendance/attendanceRead.service.js');

test('returns accurate empty out-of-range pagination', async () => {
  findAndCountAll.mockResolvedValueOnce({ count: 21, rows: [] });
  const result = await listManagementAttendances({ page: 5, limit: 10 });
  expect(result).toEqual({
    data: [],
    pagination: {
      current_page: 5, total_pages: 3, total_records: 21, records_per_page: 10,
      has_next_page: false, has_prev_page: true
    }
  });
});

test('returns null when detail is missing', async () => {
  findByPk.mockResolvedValueOnce(null);
  await expect(getManagementAttendanceDetail(999)).resolves.toBeNull();
});
```

- [ ] **Step 2: Run service tests and verify RED**

Run: `npm test -- tests/attendanceManagementReadService.test.js --runInBand`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement the Express-free read service**

```js
import { Attendance } from '../../models/index.js';
import { mapAttendanceDetail, mapAttendanceListRow } from './attendance.mapper.js';
import { buildAttendanceDetailQuery, buildAttendanceListQuery } from './attendance.query.js';

export const listManagementAttendances = async (query = {}) => {
  const page = query.page ?? 1;
  const limit = query.limit ?? 10;
  const { count, rows } = await Attendance.findAndCountAll(buildAttendanceListQuery({ ...query, page, limit }));
  const totalPages = Math.ceil(count / limit);
  return {
    data: rows.map(mapAttendanceListRow),
    pagination: {
      current_page: page, total_pages: totalPages, total_records: count,
      records_per_page: limit, has_next_page: page < totalPages,
      has_prev_page: totalPages > 0 && page > 1
    }
  };
};

export const getManagementAttendanceDetail = async (id) => {
  const row = await Attendance.findByPk(id, buildAttendanceDetailQuery());
  return row ? mapAttendanceDetail(row) : null;
};
```

- [ ] **Step 4: Verify service GREEN, then write failing controller tests**

Run: `npm test -- tests/attendanceManagementReadService.test.js --runInBand`

Expected: PASS.

Create controller tests that mock only `attendanceRead.service.js` and assert observable HTTP behavior:

```js
test('getAllAttendances returns service data in the existing envelope', async () => {
  listManagementAttendances.mockResolvedValueOnce({ data: [], pagination: expectedPagination });
  await getAllAttendances({ query: { page: 2, limit: 10 } }, res, next);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({
    success: true, message: 'Data absensi berhasil diambil', data: [],
    pagination: expectedPagination
  });
});

test('getAttendanceDetail returns deterministic 404', async () => {
  getManagementAttendanceDetail.mockResolvedValueOnce(null);
  await getAttendanceDetail({ params: { id: 999 } }, res, next);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalledWith({
    success: false, message: 'Data absensi tidak ditemukan.'
  });
});
```

Run: `npm test -- tests/attendanceManagementController.test.js --runInBand`

Expected: FAIL because the legacy controller has not delegated and does not export `getAttendanceDetail`.

- [ ] **Step 5: Replace the legacy list body with thin delegation and add detail delegation**

Add imports:

```js
import {
  getManagementAttendanceDetail,
  listManagementAttendances
} from '../modules/attendance/attendanceRead.service.js';
```

Use controllers:

```js
export const getAllAttendances = async (req, res, next) => {
  try {
    const result = await listManagementAttendances(req.query);
    return res.status(200).json({
      success: true, message: 'Data absensi berhasil diambil',
      data: result.data, pagination: result.pagination
    });
  } catch (error) {
    next(error);
  }
};

export const getAttendanceDetail = async (req, res, next) => {
  try {
    const data = await getManagementAttendanceDetail(req.params.id);
    if (!data) return res.status(404).json({ success: false, message: 'Data absensi tidak ditemukan.' });
    return res.status(200).json({ success: true, message: 'Detail absensi berhasil diambil', data });
  } catch (error) {
    next(error);
  }
};
```

Remove the obsolete `getAllAttendances` characterization sections from
`tests/attendanceReadsContract.test.js`; keep its `logLocationEvent` behavior
tests unchanged. Remove only helper state that becomes unused after those
sections are deleted.

- [ ] **Step 6: Run service/controller/read regression tests and verify GREEN**

Run:

```powershell
npm test -- tests/attendanceManagementReadService.test.js tests/attendanceManagementController.test.js tests/attendanceReadsContract.test.js --runInBand
```

Expected: PASS; service errors reach `next(error)`, missing detail is `404`, and location-event tests remain green.

- [ ] **Step 7: Commit service and controller delegation**

```powershell
git add -- src/modules/attendance/attendanceRead.service.js src/controllers/attendance.controller.js tests/attendanceManagementReadService.test.js tests/attendanceManagementController.test.js tests/attendanceReadsContract.test.js
git commit -m "feat(inf-267): serve attendance audit list and detail"
```

---

### Task 5: Route Wiring and Authorization

**Files:**
- Modify: `src/routes/attendance.routes.js:1-140`
- Modify: `tests/attendanceRouteContract.test.js:15-190`
- Create: `tests/attendanceManagementRouteValidation.test.js`

**Interfaces:**
- Consumes: validators from Task 1 and controller exports from Task 4.
- Produces: authenticated Admin/Management routes `GET /api/attendance` and `GET /api/attendance/:id` with validation before controller execution.

- [ ] **Step 1: Extend the route contract and write a real validation-boundary test**

In `attendanceRouteContract.test.js`, add `getAttendanceDetail` to the mocked controller exports and add:

```js
['get', '/api/attendance/1', 'getAttendanceDetail']
```

to `PRIVILEGED`. Extend the validator mock with:

```js
jest.unstable_mockModule('../src/modules/attendance/attendance.validation.js', () => ({
  validateAttendanceListQuery: [(req, res, next) => next()],
  validateAttendanceId: [(req, res, next) => next()]
}));
```

Update the registered-route assertion from `22` to `23`, because the lazy
weighted-prediction route remains separately asserted while `GET /:id` adds
one normal privileged route.

In the new validation-boundary test, construct an Express app using the real
attendance validation arrays, a fake authorized identity, and controller spies.
Assert `/api/attendance?page=abc` and `/api/attendance/abc` return `400
E_VALIDATION` and the relevant controller spy is never called.

```js
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const getAllAttendances = jest.fn((_req, res) => res.json({ route: 'list' }));
const getAttendanceDetail = jest.fn((_req, res) => res.json({ route: 'detail' }));
const controllerNames = [
  'getAttendanceHistory', 'getAttendanceStatus', 'checkIn', 'checkOut',
  'debugCheckInTime', 'deleteAttendance', 'manualAutoCheckout',
  'getAutoCheckoutSettings', 'manualResolveWfaBookings', 'manualGeneralAlphaForDate',
  'manualResolveWfaForDate', 'manualSmartAutoCheckoutForDate', 'logLocationEvent',
  'getSmartEngineConfig', 'getEnhancedAutoCheckoutSettings', 'getTodayLocations',
  'getGeofenceEvidence', 'previewMyAttendanceReportPdf', 'exportMyAttendanceReportPdf',
  'testWeightedPrediction'
];
jest.unstable_mockModule('../src/controllers/attendance.controller.js', () => ({
  ...Object.fromEntries(controllerNames.map((name) => [name, (_req, res) => res.json({ route: name })])),
  getAllAttendances,
  getAttendanceDetail
}));
jest.unstable_mockModule('../src/controllers/researchAttendance.controller.js', () => ({
  triggerResearchAttendanceDaily: (_req, res) => res.json({}),
  triggerResearchAttendanceFullDay: (_req, res) => res.json({})
}));
jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: (req, _res, next) => { req.user = { role_name: 'Admin' }; next(); }
}));
jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  default: () => (_req, _res, next) => next()
}));

const { default: routes } = await import('../src/routes/attendance.routes.js');
const app = express();
app.use('/api/attendance', routes);

test('list validation stops malformed pagination before the controller', async () => {
  const response = await request(app).get('/api/attendance?page=abc');
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('E_VALIDATION');
  expect(getAllAttendances).not.toHaveBeenCalled();
});
test('detail validation stops malformed IDs before the controller', async () => {
  const response = await request(app).get('/api/attendance/abc');
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('E_VALIDATION');
  expect(getAttendanceDetail).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run route tests and verify RED**

Run:

```powershell
npm test -- tests/attendanceRouteContract.test.js tests/attendanceManagementRouteValidation.test.js --runInBand
```

Expected: FAIL because list validation and `GET /:id` are not mounted.

- [ ] **Step 3: Wire validators and register detail after static GET routes**

Add imports:

```js
import {
  validateAttendanceId,
  validateAttendanceListQuery
} from '../modules/attendance/attendance.validation.js';
```

Change list registration:

```js
router.get(
  '/', roleGuard(['Admin', 'Management']),
  validateAttendanceListQuery, validate, getAllAttendances
);
```

After all static GET paths, add:

```js
router.get(
  '/:id', roleGuard(['Admin', 'Management']),
  validateAttendanceId, validate, getAttendanceDetail
);
```

Keep `DELETE /:id` byte-for-byte equivalent apart from any import/order movement.

- [ ] **Step 4: Run validation, route, and delete regression tests**

Run:

```powershell
npm test -- tests/attendanceManagementQueryValidation.test.js tests/attendanceManagementRouteValidation.test.js tests/attendanceRouteContract.test.js tests/attendanceDeleteContract.test.js --runInBand
```

Expected: PASS; Admin/Management are allowed, User is `403`, unauthenticated is `401`, malformed input is `400`, and delete behavior is unchanged.

- [ ] **Step 5: Commit route wiring**

```powershell
git add -- src/routes/attendance.routes.js tests/attendanceRouteContract.test.js tests/attendanceManagementRouteValidation.test.js
git commit -m "feat(inf-267): expose validated attendance detail route"
```

---

### Task 6: OpenAPI and Contract Inventory

**Files:**
- Modify: `docs/openapi.yaml:1606-1670,2766-2805,6502-6586`
- Modify: `docs/architecture/api-contract-inventory.md:138-180,431-440,550-558`
- Create: `tests/attendanceManagementOpenApiContract.test.js`

**Interfaces:**
- Documents the exact request and response contracts implemented in Tasks 1-5.
- Closes F30 and F36; F39 remains open because INF-267 intentionally preserves attendance pagination keys.

- [ ] **Step 1: Write a failing OpenAPI consumer contract**

```js
import fs from 'fs';
import path from 'path';
import yaml from 'yamljs';

const api = yaml.parse(fs.readFileSync(path.resolve('docs/openapi.yaml'), 'utf8'));

test('documents every Management Attendance list query parameter', () => {
  const operation = api.paths['/api/attendance'].get;
  const params = Object.fromEntries(operation.parameters.map((item) => [item.name, item]));
  expect(Object.keys(params).sort()).toEqual([
    'checkout_state', 'from', 'limit', 'mode', 'page', 'search',
    'sortBy', 'sortOrder', 'status', 'to'
  ]);
  expect(params.limit.schema).toMatchObject({ default: 10, minimum: 1, maximum: 100 });
  expect(params.status.schema.enum).toEqual(['ontime', 'late', 'alpha', 'early']);
  expect(operation.responses).toHaveProperty('400');
});

test('documents GET attendance detail separately from DELETE', () => {
  const pathItem = api.paths['/api/attendance/{id}'];
  expect(pathItem.get).toBeDefined();
  expect(pathItem.delete).toBeDefined();
  const detail = pathItem.get.responses['200'].content['application/json'].schema;
  expect(detail.properties.data.properties).toHaveProperty('booking_id');
  expect(detail.properties.data.properties.user.properties).toHaveProperty('email');
  expect(detail.properties.data.properties.location.nullable).toBe(true);
  expect(pathItem.get.responses).toHaveProperty('404');
});
```

- [ ] **Step 2: Run the OpenAPI test and verify RED**

Run: `npm test -- tests/attendanceManagementOpenApiContract.test.js --runInBand`

Expected: FAIL because the existing OpenAPI lists ignored `date`/`user_id`, omits new filters/sorts, documents the wrong list envelope, and has no GET detail operation.

- [ ] **Step 3: Update OpenAPI with explicit component schemas**

Replace ignored `date` and `user_id` parameters with the ten supported query
parameters, including enums/defaults/minimum/maximum. Document list `data` as
an array and `pagination` as its sibling. Add schemas for:

```yaml
AttendanceAuditMode:
  type: object
  required: [key, label]
  properties:
    key: { type: string, nullable: true, enum: [wfo, wfh, wfa] }
    label: { type: string, nullable: true }
AttendanceAuditStatus:
  type: object
  required: [key, label]
  properties:
    key: { type: string, nullable: true, enum: [ontime, late, alpha, early] }
    label: { type: string, nullable: true }
AttendanceAuditListRow:
  type: object
  required: [id_attendance, attendance_date, user, time_in, time_out, work_duration, mode, status, location]
AttendanceAuditDetail:
  type: object
  required: [id_attendance, attendance_date, time_in, time_out, work_duration, mode, status, notes, booking_id, user, location]
```

Define every nested property from the approved design rather than using a free-form object. Add GET under `/api/attendance/{id}` while retaining its existing DELETE operation unchanged.

- [ ] **Step 4: Update inventory findings and endpoint count**

Change Attendance from 23 to 24 endpoints, add `GET /:id`, mark F30 closed by
route validation, mark F36 closed by the corrected OpenAPI contract, and retain
F39 with a note that compatibility-preserving attendance pagination is an
explicit INF-267 decision.

- [ ] **Step 5: Run documentation contract tests and verify GREEN**

Run:

```powershell
npm test -- tests/attendanceManagementOpenApiContract.test.js tests/clientCriticalOpenApiContract.test.js tests/openApiMountedRoutesContract.test.js tests/findingsRegisterGuard.test.js --runInBand
```

Expected: PASS; OpenAPI, mounted routes, and inventory guards agree.

- [ ] **Step 6: Commit documentation**

```powershell
git add -- docs/openapi.yaml docs/architecture/api-contract-inventory.md tests/attendanceManagementOpenApiContract.test.js
git commit -m "docs(inf-267): publish attendance audit contracts"
```

---

### Task 7: Full Verification and Runtime Evidence Boundary

**Files:**
- Modify only if a test exposes a scoped defect in files already listed above.
- Do not create fake runtime evidence.

**Interfaces:**
- Produces fresh lint/Jest evidence and an honest runtime verification status for the PR handoff.

- [ ] **Step 1: Run all focused attendance management tests**

Run:

```powershell
npm test -- tests/attendanceManagementQueryValidation.test.js tests/attendanceManagementQuery.test.js tests/attendanceManagementMapper.test.js tests/attendanceManagementReadService.test.js tests/attendanceManagementController.test.js tests/attendanceManagementRouteValidation.test.js tests/attendanceManagementOpenApiContract.test.js tests/attendanceRouteContract.test.js tests/attendanceReadsContract.test.js tests/attendanceDeleteContract.test.js --runInBand
```

Expected: every focused suite passes with zero failures.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: exit code `0` with no ESLint errors.

- [ ] **Step 3: Run the complete unit/contract suite**

Run: `npm test -- --runInBand`

Expected: all suites and tests pass. Record the exact counts from this fresh run.

- [ ] **Step 4: Inspect the final diff and contract boundaries**

Run:

```powershell
git diff --check origin/develop...HEAD
git diff --stat origin/develop...HEAD
git status --short --branch
git log --oneline origin/develop..HEAD
```

Expected: no whitespace errors, no main-checkout files, no dependency changes,
and no mutation/job files in the diff.

- [ ] **Step 5: Gather runtime evidence only if a compatible authenticated runtime is available**

First perform read-only checks:

```powershell
docker compose ps
curl.exe -sS -o NUL -w "%{http_code}" http://localhost:3000/health
```

If the running app is built from this branch and valid Admin/Management tokens
are already available without exposing them, exercise:

```text
GET /api/attendance?page=1&limit=10&search=100%25&from=2026-07-01&to=2026-07-31&mode=wfh&status=late&checkout_state=completed&sortBy=attendance_date&sortOrder=DESC
GET /api/attendance?page=abc
GET /api/attendance/999999999
GET /api/attendance/{known-id}
```

Capture status codes and redacted response shapes. If branch runtime, database,
or authentication is unavailable, record `Needs Verification: Postman/runtime`
in the PR notes; lint/Jest evidence must not be presented as runtime proof.

- [ ] **Step 6: Run verification-before-completion and request code review**

Invoke `superpowers:verification-before-completion`, then
`superpowers:requesting-code-review`. Address only findings that are verified,
in scope, and backed by a failing test.

- [ ] **Step 7: Commit any review corrections and rerun affected gates**

```powershell
git add -u -- src/modules/attendance src/controllers/attendance.controller.js src/routes/attendance.routes.js tests docs/openapi.yaml docs/architecture/api-contract-inventory.md
git commit -m "fix(inf-267): address attendance contract review"
```

Skip this commit when review finds no actionable defects. Never create an empty commit.
