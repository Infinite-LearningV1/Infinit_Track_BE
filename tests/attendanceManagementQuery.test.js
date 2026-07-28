import { Op } from 'sequelize';
import { AttendanceStatus, User } from '../src/models/index.js';
import {
  buildAttendanceDetailQuery,
  buildAttendanceListQuery,
  escapeAttendanceLike
} from '../src/modules/attendance/attendance.query.js';

test('escapes LIKE wildcard characters literally', () => {
  expect(escapeAttendanceLike(String.raw`A_100%\\done`)).toBe(String.raw`A\_100\%\\\\done`);
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

test('falls back to the stable default order for an unallowlisted sort key', () => {
  expect(buildAttendanceListQuery({ page: 1, limit: 10, sortBy: 'arbitrary_column' }).order)
    .toEqual([
      ['attendance_date', 'DESC'], ['time_in', 'DESC'], ['id_attendance', 'DESC']
    ]);
});

test('builds a detail projection with its related attendance metadata', () => {
  const options = buildAttendanceDetailQuery();

  expect(options.attributes).toEqual(expect.arrayContaining(['notes', 'booking_id']));
  expect(options.include.map((item) => item.as)).toEqual([
    'user', 'location', 'status', 'attendance_category'
  ]);
});
