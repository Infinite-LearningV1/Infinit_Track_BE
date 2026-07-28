import { formatTimeOnly, formatWorkHour } from '../../utils/workHourFormatter.js';

const MODES = {
  1: { key: 'wfo', label: 'WFO' },
  2: { key: 'wfh', label: 'WFH' },
  3: { key: 'wfa', label: 'WFA' }
};

const STATUSES = {
  1: { key: 'ontime', label: 'On Time' },
  2: { key: 'late', label: 'Late' },
  3: { key: 'alpha', label: 'Alpha' },
  4: { key: 'early', label: 'Early' }
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const timeOrNull = (value) => value ? formatTimeOnly(value) : null;
const durationOrNull = (value) => value === null || value === undefined ? null : formatWorkHour(value);
const modeOf = (row) => MODES[row.category_id] ?? {
  key: null,
  label: row.attendance_category?.category_name ?? null
};
const statusOf = (row) => STATUSES[row.status_id] ?? {
  key: null,
  label: row.status?.attendance_status_name ?? null
};
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
    available: true,
    id: row.location.location_id,
    description: row.location.description ?? null
  } : { available: false, id: null, description: null }
});

export const mapAttendanceDetail = (row) => ({
  id_attendance: row.id_attendance,
  attendance_date: row.attendance_date,
  time_in: timeOrNull(row.time_in),
  time_out: timeOrNull(row.time_out),
  work_duration: durationOrNull(row.work_hour),
  mode: modeOf(row),
  status: statusOf(row),
  notes: row.notes ?? '',
  booking_id: row.booking_id ?? null,
  user: userOf(row, true),
  location: row.location ? {
    id: row.location.location_id,
    description: row.location.description ?? null,
    latitude: numberOrNull(row.location.latitude),
    longitude: numberOrNull(row.location.longitude),
    radius: numberOrNull(row.location.radius)
  } : null
});
