import { Op } from 'sequelize';

import * as Models from '../models/index.js';
import { calculateWorkHour, formatTimeOnly, formatWorkHour } from '../utils/workHourFormatter.js';

const { Attendance, AttendanceCategory, AttendanceStatus, Division, Location, Position, Role, User } = Models;

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEFAULT_TIMEZONE = 'Asia/Jakarta';
const SUPPORTED_PERIODS = new Set(['daily', 'weekly', 'monthly', 'custom']);
const VERIFIED_DISTRIBUTION_KEYS = new Set(['wfo', 'wfa', 'other']);

const normalize = (value) => String(value || '').trim().toLowerCase();

const buildValidationError = (message) => {
  const error = new Error(message);
  error.code = 'E_VALIDATION';
  error.statusCode = 400;
  return error;
};

const isStrictDateOnly = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const getDatePartsInTimezone = (date, timezone) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return formatter.formatToParts(date).reduce((parts, part) => {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
    return parts;
  }, {});
};

const toDateOnly = ({ year, month, day }) => {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const addDays = (dateOnly, days) => {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getLastDayOfMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const buildDateLabel = (dateOnly) => {
  const [year, month, day] = String(dateOnly).split('-').map(Number);
  if (!year || !month || !day) return String(dateOnly || '');
  return `${String(day).padStart(2, '0')} ${MONTH_LABELS[month - 1]} ${year}`;
};

const buildPeriodDisplayLabel = (period, startDate, endDate) => {
  if (period === 'daily') return buildDateLabel(startDate);
  if (period === 'monthly') {
    const [year, month] = startDate.split('-').map(Number);
    return `${MONTH_LABELS[month - 1]} ${year}`;
  }

  return `${buildDateLabel(startDate)} - ${buildDateLabel(endDate)}`;
};

export const buildPersonalAttendanceReportPeriod = (query = {}, now = new Date()) => {
  const period = query.period || 'monthly';
  const timezone = query.timezone || DEFAULT_TIMEZONE;

  if (!SUPPORTED_PERIODS.has(period)) {
    throw buildValidationError('Period parameter tidak valid. Gunakan: daily, weekly, monthly, atau custom');
  }

  if (period === 'custom') {
    const startDate = query.start_date;
    const endDate = query.end_date;

    if (!isStrictDateOnly(startDate) || !isStrictDateOnly(endDate)) {
      throw buildValidationError(
        'Parameter start_date dan end_date wajib valid dengan format YYYY-MM-DD untuk period custom'
      );
    }

    if (startDate > endDate) {
      throw buildValidationError('Parameter start_date tidak boleh lebih besar dari end_date');
    }

    return {
      type: period,
      label: 'Custom Range',
      display_label: buildPeriodDisplayLabel(period, startDate, endDate),
      start_date: startDate,
      end_date: endDate,
      timezone
    };
  }

  const currentDate = toDateOnly(getDatePartsInTimezone(now, timezone));
  let startDate = currentDate;
  let endDate = currentDate;

  if (period === 'weekly') {
    const date = new Date(`${currentDate}T00:00:00Z`);
    const dayOfWeek = date.getUTCDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startDate = addDays(currentDate, diffToMonday);
    endDate = addDays(startDate, 6);
  }

  if (period === 'monthly') {
    const { year, month } = getDatePartsInTimezone(now, timezone);
    startDate = toDateOnly({ year, month, day: 1 });
    endDate = toDateOnly({ year, month, day: getLastDayOfMonth(year, month) });
  }

  return {
    type: period,
    label: period === 'daily' ? 'Today' : period === 'weekly' ? 'This Week' : 'This Month',
    display_label: buildPeriodDisplayLabel(period, startDate, endDate),
    start_date: startDate,
    end_date: endDate,
    timezone
  };
};

const deriveModeContract = (attendance) => {
  const categoryName = attendance.attendance_category?.category_name || null;
  const normalized = normalize(categoryName);

  if (attendance.category_id === 1 || ['wfo', 'work from office'].includes(normalized)) {
    return { mode_key: 'wfo', mode_label: 'WFO' };
  }

  if (attendance.category_id === 2 || ['wfh', 'work from home'].includes(normalized)) {
    return { mode_key: 'wfh', mode_label: 'WFH' };
  }

  if (attendance.category_id === 3 || ['wfa', 'work from anywhere'].includes(normalized)) {
    return { mode_key: 'wfa', mode_label: 'WFA' };
  }

  return { mode_key: normalized || 'other', mode_label: categoryName || 'Other' };
};

const deriveStatusContract = (attendance) => {
  const statusName = attendance.status?.attendance_status_name || null;
  const normalized = normalize(statusName);

  if (attendance.status_id === 1 || ['ontime', 'on time', 'tepat waktu'].includes(normalized)) {
    return { status_key: 'ontime', status_label: 'On Time' };
  }

  if (attendance.status_id === 2 || ['late', 'terlambat'].includes(normalized)) {
    return { status_key: 'late', status_label: 'Late' };
  }

  if (attendance.status_id === 3 || ['alpha', 'alpa', 'absent'].includes(normalized)) {
    return { status_key: 'alpha', status_label: 'Alpha' };
  }

  if (attendance.status_id === 4 || ['early', 'lebih awal'].includes(normalized)) {
    return { status_key: 'early', status_label: 'Early' };
  }

  return { status_key: normalized || 'other', status_label: statusName || 'Other' };
};

const resolveWorkHour = (attendance, isAlpha) => {
  if (isAlpha) return { work_hour: null, work_hour_raw: null };

  let workHour = attendance.work_hour;
  try {
    const rawIn = attendance.time_in ? new Date(attendance.time_in) : null;
    const rawOut = attendance.time_out ? new Date(attendance.time_out) : null;
    const outBeforeIn = rawIn && rawOut ? rawOut.getTime() < rawIn.getTime() : false;

    if ((workHour == null || workHour <= 0 || outBeforeIn) && rawIn && rawOut) {
      workHour = calculateWorkHour(rawIn, rawOut);
    }
  } catch (_error) {
    // Keep original work hour value and normalize below.
  }

  const numericWorkHour = Number(workHour);
  return {
    work_hour: Number.isFinite(numericWorkHour) && numericWorkHour > 0 ? formatWorkHour(numericWorkHour) : null,
    work_hour_raw: Number.isFinite(numericWorkHour) && numericWorkHour > 0 ? numericWorkHour : null
  };
};

const buildTimelineRow = (attendance) => {
  const mode = deriveModeContract(attendance);
  const status = deriveStatusContract(attendance);
  const isAlpha = status.status_key === 'alpha';
  const timeIn = !isAlpha && attendance.time_in ? formatTimeOnly(attendance.time_in) : null;
  const timeOut = !isAlpha && attendance.time_out ? formatTimeOnly(attendance.time_out) : null;
  const workHour = resolveWorkHour(attendance, isAlpha);

  return {
    attendance_id: attendance.id_attendance,
    attendance_date: attendance.attendance_date,
    date_label: buildDateLabel(attendance.attendance_date),
    mode_key: mode.mode_key,
    mode_label: mode.mode_label,
    time_in: timeIn,
    time_out: timeOut,
    time_range: isAlpha ? '--:-- - --:--' : `${timeIn || '--:--'} - ${timeOut || '--:--'}`,
    ...workHour,
    status_key: status.status_key,
    status_label: status.status_label,
    location_label: attendance.location?.description || null,
    notes: attendance.notes || null
  };
};

const formatWorkHoursLabel = (workHours) => {
  const numericWorkHours = Number(workHours);
  if (!Number.isFinite(numericWorkHours) || numericWorkHours <= 0) return '0h';

  const totalMinutes = Math.round(numericWorkHours * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
};

const buildSummary = (timeline) => {
  const summary = {
    attendance_rate: null,
    attendance_rate_percent: null,
    attendance_rate_label: 'N/A',
    attendance_rate_denominator: 'total_counted_days',
    attendance_rate_note: 'No counted attendance days are available for this report period.',
    expected_working_days: null,
    expected_working_days_label: 'Unavailable',
    expected_working_days_note: 'Official expected working day denominator is not verified for this report.',
    attended_days: 0,
    total_present: 0,
    total_absent: 0,
    total_counted_days: 0,
    total_work_hours: 0,
    total_work_hours_label: '0h',
    on_time_days: 0,
    late_days: 0,
    alpha_days: 0,
    late: 0,
    alpha: 0,
    status_counters: {
      ontime: 0,
      late: 0,
      alpha: 0,
      early: 0,
      other: 0
    }
  };

  for (const row of timeline) {
    if (row.status_key === 'alpha') {
      summary.alpha += 1;
      summary.alpha_days += 1;
      summary.status_counters.alpha += 1;
      continue;
    }

    summary.attended_days += 1;
    if (row.status_key === 'late') {
      summary.late += 1;
      summary.late_days += 1;
    }
    if (row.status_key === 'ontime') summary.on_time_days += 1;
    if (summary.status_counters[row.status_key] == null) summary.status_counters.other += 1;
    else summary.status_counters[row.status_key] += 1;

    if (Number.isFinite(row.work_hour_raw)) {
      summary.total_work_hours += row.work_hour_raw;
    }
  }

  summary.total_present = summary.attended_days;
  summary.total_absent = summary.alpha_days;
  summary.total_counted_days = summary.total_present + summary.total_absent;

  if (summary.total_counted_days > 0) {
    const attendanceRate = Math.round((summary.total_present / summary.total_counted_days) * 100);
    summary.attendance_rate = attendanceRate;
    summary.attendance_rate_percent = attendanceRate;
    summary.attendance_rate_label = `${attendanceRate}%`;
    summary.attendance_rate_note = 'Based on counted attendance days in this report.';
  }

  summary.total_work_hours = Number(summary.total_work_hours.toFixed(2));
  summary.total_work_hours_label = formatWorkHoursLabel(summary.total_work_hours);
  return summary;
};

const roundPercentage = (count, total) => (total > 0 ? Math.round((count / total) * 100) : 0);

const buildStatusDistribution = (summary) => {
  const total = summary.total_counted_days;
  const distribution = {
    on_time: {
      key: 'on_time',
      label: 'On Time',
      count: summary.on_time_days,
      percentage: roundPercentage(summary.on_time_days, total)
    },
    late: {
      key: 'late',
      label: 'Late',
      count: summary.late_days,
      percentage: roundPercentage(summary.late_days, total)
    },
    alpha: {
      key: 'alpha',
      label: 'Alpha',
      count: summary.alpha_days,
      percentage: roundPercentage(summary.alpha_days, total)
    }
  };

  if (summary.status_counters.early > 0) {
    distribution.early = {
      key: 'early',
      label: 'Early',
      count: summary.status_counters.early,
      percentage: roundPercentage(summary.status_counters.early, total)
    };
  }

  if (summary.status_counters.other > 0) {
    distribution.other = {
      key: 'other',
      label: 'Other',
      count: summary.status_counters.other,
      percentage: roundPercentage(summary.status_counters.other, total)
    };
  }

  return distribution;
};

const buildModeDistribution = (timeline) => {
  const distribution = {
    wfo: { count: 0, included: true, label: 'WFO' },
    wfa: { count: 0, included: true, label: 'WFA' },
    wfh: {
      count: 0,
      included: false,
      label: 'WFH',
      note: 'Needs Verification: WFH category mapping is tracked by INF-164 and omitted from official percentage.'
    },
    other: { count: 0, included: true, label: 'Other' }
  };

  for (const row of timeline) {
    if (distribution[row.mode_key]) distribution[row.mode_key].count += 1;
    else distribution.other.count += 1;
  }

  const includedTotal = Object.entries(distribution).reduce((total, [key, item]) => {
    return item.included && VERIFIED_DISTRIBUTION_KEYS.has(key) ? total + item.count : total;
  }, 0);

  for (const item of Object.values(distribution)) {
    item.percentage = item.included && includedTotal > 0 ? Number(((item.count / includedTotal) * 100).toFixed(2)) : null;
  }

  if (distribution.other.count === 0) distribution.other.included = false;
  return distribution;
};

export const buildPersonalAttendanceReportPayload = async ({ userId, query = {}, now = new Date() }) => {
  const period = buildPersonalAttendanceReportPeriod(query, now);
  const userIncludes = [
    { model: Role, as: 'role', attributes: ['role_name'], required: false },
    { model: Position, as: 'position', attributes: ['position_name'], required: false }
  ];

  if (Division) {
    userIncludes.push({ model: Division, as: 'division', attributes: ['division_name'], required: false });
  }

  const [user, attendanceRows] = await Promise.all([
    User.findByPk(userId, {
      attributes: ['id_users', 'full_name', 'nip_nim'],
      include: userIncludes
    }),
    Attendance.findAll({
      where: {
        user_id: userId,
        attendance_date: {
          [Op.between]: [period.start_date, period.end_date]
        }
      },
      include: [
        { model: AttendanceCategory, as: 'attendance_category', attributes: ['category_name'] },
        { model: AttendanceStatus, as: 'status', attributes: ['attendance_status_name'] },
        { model: Location, as: 'location', attributes: ['description'], required: false }
      ],
      order: [
        ['attendance_date', 'ASC'],
        ['id_attendance', 'ASC']
      ]
    })
  ]);

  if (!user) {
    const error = new Error('Authenticated user not found');
    error.code = 'E_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  const timeline = attendanceRows.map(buildTimelineRow);
  const summary = buildSummary(timeline);
  const generatedAt = now.toISOString();

  return {
    report_metadata: {
      title: 'My Attendance Report',
      brand: 'Infinite Track',
      generated_at: generatedAt,
      generated_by: 'Infinite Track Backend',
      timezone: period.timezone,
      source_of_truth_notice: 'Generated from backend attendance records as the source of truth.'
    },
    user: {
      id: user.id_users,
      full_name: user.full_name,
      nip_nim: user.nip_nim || null,
      role: user.role?.role_name || null,
      position: user.position?.position_name || null,
      division: user.division?.division_name || null
    },
    period,
    summary,
    status_distribution: buildStatusDistribution(summary),
    mode_distribution: buildModeDistribution(timeline),
    timeline,
    empty_state: {
      is_empty: timeline.length === 0,
      message: timeline.length === 0 ? 'No attendance records are available for this period.' : null
    }
  };
};
