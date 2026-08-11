import {
  mapAttendanceDetail,
  mapAttendanceListRow
} from '../src/modules/attendance/attendance.mapper.js';

const row = {
  id_attendance: 42, attendance_date: '2026-07-28',
  time_in: new Date(2026, 6, 28, 8, 2), time_out: new Date(2026, 6, 28, 17, 5),
  work_hour: 9.05, category_id: 1, status_id: 1, notes: 'Verified', booking_id: 55,
  user: {
    id_users: 7,
    full_name: 'Andi Saputra',
    nip_nim: 'EMP-007',
    email: 'andi@example.com',
    role: { role_name: 'User' },
    photo_file: {
      photo_url: 'https://cdn.example.com/users/7/profile/photo.jpg',
      photo_updated_at: new Date('2026-08-10T08:30:00.000Z')
    }
  },
  attendance_category: { category_name: 'Work From Office' },
  status: { attendance_status_name: 'Tepat Waktu' },
  location: { location_id: 1, description: 'Palu Office', latitude: '-0.900291', longitude: '119.877998', radius: '100' }
};

test('maps only audit-table fields in the list row', () => {
  const result = mapAttendanceListRow(row);
  expect(result).toEqual({
    id_attendance: 42, attendance_date: '2026-07-28',
    user: {
      id: 7,
      full_name: 'Andi Saputra',
      nip_nim: 'EMP-007',
      photo: 'https://cdn.example.com/users/7/profile/photo.jpg',
      photo_updated_at: new Date('2026-08-10T08:30:00.000Z'),
      role: 'User'
    },
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
  expect(result.user).toEqual({
    id: null,
    full_name: null,
    nip_nim: null,
    photo: null,
    photo_updated_at: null,
    role: null
  });
});
