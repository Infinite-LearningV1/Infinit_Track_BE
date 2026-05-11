import { QueryTypes } from 'sequelize';

import sequelize from '../config/database.js';
import { Division, Role, User } from '../models/index.js';

const ON_TIME_STATUS = new Set(['tepat waktu', 'ontime']);
const LATE_STATUS = new Set(['terlambat', 'late']);
const EARLY_STATUS = new Set(['early', 'lebih awal']);
const ALPHA_STATUS = new Set(['alpa', 'alpha']);

const WFO_CATEGORY = new Set(['wfo', 'work from office']);
const WFH_CATEGORY = new Set(['wfh', 'work from home']);
const WFA_CATEGORY = new Set(['wfa', 'work from anywhere']);

const JAKARTA_WEEKDAY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Jakarta',
  weekday: 'short'
});

const JAKARTA_DATE_ONLY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const normalize = (value) => String(value || '').trim().toLowerCase();

const toDateAtJakartaLocalNoon = (dateStr) => new Date(`${dateStr}T12:00:00+07:00`);

const getJakartaDateOnly = (value) => {
  if (!value) return null;

  if (value instanceof Date) {
    return JAKARTA_DATE_ONLY.format(value);
  }

  const asString = String(value);
  const directDateOnlyMatch = asString.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (directDateOnlyMatch) {
    const [, year, month, day] = directDateOnlyMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const parsed = new Date(asString);
  if (Number.isNaN(parsed.getTime())) return null;
  return JAKARTA_DATE_ONLY.format(parsed);
};

const getRowSortTimestamp = (row) => {
  const candidates = [row?.time_in, row?.created_at, row?.updated_at].filter(Boolean);
  for (const value of candidates) {
    const ts = new Date(value).getTime();
    if (!Number.isNaN(ts)) return ts;
  }

  const dateOnly = getJakartaDateOnly(row?.attendance_date);
  if (!dateOnly) return Number.NEGATIVE_INFINITY;

  return toDateAtJakartaLocalNoon(dateOnly).getTime();
};

const createSummaryShell = (user, expectedWorkingDays) => ({
  user_id: user.id_users,
  full_name: user.full_name,
  role_name: user.role?.role_name ?? null,
  division: user.division?.division_name ?? null,
  expected_working_days: expectedWorkingDays,
  on_time_days: 0,
  late_days: 0,
  early_days: 0,
  alpha_days: 0,
  wfo_days: 0,
  wfh_days: 0,
  wfa_days: 0,
  valid_attendance_days: 0,
  attendance_coverage_label: null,
  latest_attendance_status: null,
  latest_attendance_date: null,
  summary_note: 'Partial'
});

const finalizeSummary = (summary) => {
  summary.valid_attendance_days = summary.on_time_days + summary.late_days;

  if (summary.expected_working_days == null) {
    summary.summary_note = 'Expected days unavailable';
    return summary;
  }

  summary.attendance_coverage_label = `${summary.valid_attendance_days}/${summary.expected_working_days}`;
  summary.summary_note = summary.valid_attendance_days === summary.expected_working_days ? 'Complete' : 'Partial';

  return summary;
};

const toCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildAttendanceDateFilter = ({ period, startDate, endDate, tableAlias }) => {
  if (period !== 'all' && startDate && endDate) {
    return `${tableAlias}.attendance_date BETWEEN :startDate AND :endDate`;
  }

  return '1 = 1';
};

const loadAttendanceMetricsByUser = async ({ period, startDate, endDate }) => {
  const outerDateFilter = buildAttendanceDateFilter({ period, startDate, endDate, tableAlias: 'a' });
  const innerDateFilter = buildAttendanceDateFilter({ period, startDate, endDate, tableAlias: 'a2' });

  const query = `
    SELECT
      a.user_id,
      SUM(CASE WHEN LOWER(TRIM(COALESCE(s.attendance_status_name, ''))) IN ('tepat waktu', 'ontime') THEN 1 ELSE 0 END) AS on_time_days,
      SUM(CASE WHEN LOWER(TRIM(COALESCE(s.attendance_status_name, ''))) IN ('terlambat', 'late') THEN 1 ELSE 0 END) AS late_days,
      SUM(CASE WHEN LOWER(TRIM(COALESCE(s.attendance_status_name, ''))) IN ('early', 'lebih awal') THEN 1 ELSE 0 END) AS early_days,
      SUM(CASE WHEN LOWER(TRIM(COALESCE(s.attendance_status_name, ''))) IN ('alpa', 'alpha') THEN 1 ELSE 0 END) AS alpha_days,
      SUM(CASE WHEN LOWER(TRIM(COALESCE(c.category_name, ''))) IN ('wfo', 'work from office') THEN 1 ELSE 0 END) AS wfo_days,
      SUM(CASE WHEN LOWER(TRIM(COALESCE(c.category_name, ''))) IN ('wfh', 'work from home') THEN 1 ELSE 0 END) AS wfh_days,
      SUM(CASE WHEN LOWER(TRIM(COALESCE(c.category_name, ''))) IN ('wfa', 'work from anywhere') THEN 1 ELSE 0 END) AS wfa_days,
      (
        SELECT s2.attendance_status_name
        FROM attendance a2
        LEFT JOIN attendance_statuses s2 ON s2.id_attendance_status = a2.status_id
        WHERE a2.user_id = a.user_id
          AND ${innerDateFilter}
        ORDER BY a2.attendance_date DESC, a2.time_in DESC, a2.created_at DESC, a2.updated_at DESC, a2.id_attendance DESC
        LIMIT 1
      ) AS latest_attendance_status,
      (
        SELECT a2.attendance_date
        FROM attendance a2
        WHERE a2.user_id = a.user_id
          AND ${innerDateFilter}
        ORDER BY a2.attendance_date DESC, a2.time_in DESC, a2.created_at DESC, a2.updated_at DESC, a2.id_attendance DESC
        LIMIT 1
      ) AS latest_attendance_date
    FROM attendance a
    LEFT JOIN attendance_statuses s ON s.id_attendance_status = a.status_id
    LEFT JOIN attendance_categories c ON c.id_attendance_categories = a.category_id
    WHERE ${outerDateFilter}
    GROUP BY a.user_id
    ORDER BY a.user_id ASC
  `;

  const replacements =
    period !== 'all' && startDate && endDate
      ? {
          startDate,
          endDate
        }
      : {};

  return sequelize.query(query, {
    replacements,
    type: QueryTypes.SELECT
  });
};

export const countExpectedWorkingDays = ({ period, startDate, endDate }) => {
  if (period === 'all') return null;
  if (!startDate || !endDate) return 0;

  let count = 0;
  for (
    let cursor = toDateAtJakartaLocalNoon(startDate);
    cursor.getTime() <= toDateAtJakartaLocalNoon(endDate).getTime();
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
  ) {
    const weekday = JAKARTA_WEEKDAY.format(cursor);
    if (weekday !== 'Sat' && weekday !== 'Sun') {
      count += 1;
    }
  }

  return count;
};

export const summarizeAttendanceRecords = ({ user, attendanceRows, expectedWorkingDays }) => {
  const summary = createSummaryShell(user, expectedWorkingDays);
  let latestRow = null;

  for (const row of attendanceRows) {
    const statusName = normalize(row?.status?.attendance_status_name);
    if (ON_TIME_STATUS.has(statusName)) summary.on_time_days += 1;
    if (LATE_STATUS.has(statusName)) summary.late_days += 1;
    if (EARLY_STATUS.has(statusName)) summary.early_days += 1;
    if (ALPHA_STATUS.has(statusName)) summary.alpha_days += 1;

    const categoryName = normalize(row?.attendance_category?.category_name);
    if (WFO_CATEGORY.has(categoryName)) summary.wfo_days += 1;
    if (WFH_CATEGORY.has(categoryName)) summary.wfh_days += 1;
    if (WFA_CATEGORY.has(categoryName)) summary.wfa_days += 1;

    if (!latestRow) {
      latestRow = row;
      continue;
    }

    const rowTime = getRowSortTimestamp(row);
    const latestTime = getRowSortTimestamp(latestRow);
    if (rowTime > latestTime) {
      latestRow = row;
      continue;
    }

    if (rowTime === latestTime && Number(row?.id_attendance || 0) > Number(latestRow?.id_attendance || 0)) {
      latestRow = row;
    }
  }

  if (latestRow) {
    summary.latest_attendance_status = latestRow.status?.attendance_status_name ?? null;
    summary.latest_attendance_date = getJakartaDateOnly(latestRow.attendance_date);
  }

  return finalizeSummary(summary);
};

export const buildUserAttendanceSummary = async ({ period, startDate, endDate }) => {
  const expectedWorkingDays = countExpectedWorkingDays({
    period,
    startDate,
    endDate
  });

  const [users, attendanceMetrics] = await Promise.all([
    User.findAll({
      attributes: ['id_users', 'full_name'],
      include: [
        { model: Role, as: 'role', attributes: ['role_name'], required: false },
        { model: Division, as: 'division', attributes: ['division_name'], required: false }
      ],
      order: [['id_users', 'ASC']]
    }),
    loadAttendanceMetricsByUser({
      period,
      startDate,
      endDate
    })
  ]);

  const metricsByUserId = new Map(
    attendanceMetrics.map((row) => [String(row.user_id), row])
  );

  return users.map((user) => {
    const summary = createSummaryShell(user, expectedWorkingDays);
    const metrics = metricsByUserId.get(String(user.id_users));

    if (!metrics) {
      return finalizeSummary(summary);
    }

    summary.on_time_days = toCount(metrics.on_time_days);
    summary.late_days = toCount(metrics.late_days);
    summary.early_days = toCount(metrics.early_days);
    summary.alpha_days = toCount(metrics.alpha_days);
    summary.wfo_days = toCount(metrics.wfo_days);
    summary.wfh_days = toCount(metrics.wfh_days);
    summary.wfa_days = toCount(metrics.wfa_days);
    summary.latest_attendance_status = metrics.latest_attendance_status || null;
    summary.latest_attendance_date = getJakartaDateOnly(metrics.latest_attendance_date);

    return finalizeSummary(summary);
  });
};
