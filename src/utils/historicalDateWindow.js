import { getJakartaDateString } from './geofence.js';
import { parseIsoDateUtcStrict } from './isoDate.js';

export const HISTORICAL_WINDOW_PERIODS = ['30d', 'current_month', 'custom'];
export const HISTORICAL_WINDOW_MAX_CUSTOM_DAYS = 31;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const formatDateOnly = (date) => date.toISOString().split('T')[0];

export const parseDateOnlyUtc = (value) => {
  const date = parseIsoDateUtcStrict(value);

  if (!date) {
    throw new Error(`Invalid ISO date: ${value}`);
  }

  return date;
};

export const addUtcDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

export const buildJakartaDayStartUtc = (dateStr) => new Date(`${dateStr}T00:00:00+07:00`);

export const buildRequestedWindow = ({ period = '30d', from = null, to = null } = {}) => ({
  period,
  from,
  to
});

export const validateHistoricalDateWindowQuery = ({ period = '30d', from = null, to = null } = {}) => {
  if (!HISTORICAL_WINDOW_PERIODS.includes(period)) {
    return 'Parameter period harus berupa: 30d, current_month, atau custom';
  }

  if (from && !parseIsoDateUtcStrict(from)) {
    return 'Parameter from harus menggunakan format YYYY-MM-DD';
  }

  if (to && !parseIsoDateUtcStrict(to)) {
    return 'Parameter to harus menggunakan format YYYY-MM-DD';
  }

  if (period !== 'custom') {
    return null;
  }

  if (!from || !to) {
    return 'Parameter from dan to wajib diisi saat period=custom';
  }

  const fromDate = parseIsoDateUtcStrict(from);
  const toDate = parseIsoDateUtcStrict(to);

  if (!fromDate || !toDate) {
    return null;
  }

  if (fromDate.getTime() > toDate.getTime()) {
    return 'Parameter from tidak boleh lebih besar dari to';
  }

  const rangeDays = Math.floor((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY) + 1;
  if (rangeDays > HISTORICAL_WINDOW_MAX_CUSTOM_DAYS) {
    return 'Rentang tanggal custom maksimal 31 hari';
  }

  return null;
};

export const buildEffectiveWindow = ({ period = '30d', from = null, to = null } = {}) => {
  const validationMessage = validateHistoricalDateWindowQuery({ period, from, to });
  if (validationMessage) {
    throw new Error(validationMessage);
  }

  const todayDate = getJakartaDateString();
  const todayUtc = parseDateOnlyUtc(todayDate);

  if (period === 'custom') {
    const startDate = parseDateOnlyUtc(from);
    const endDate = parseDateOnlyUtc(to);

    return {
      startDate,
      endDate,
      startDateStr: from,
      endDateStr: to
    };
  }

  if (period === 'current_month') {
    const startDate = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), 1));
    return {
      startDate,
      endDate: todayUtc,
      startDateStr: formatDateOnly(startDate),
      endDateStr: todayDate
    };
  }

  const startDate = addUtcDays(todayUtc, -29);
  return {
    startDate,
    endDate: todayUtc,
    startDateStr: formatDateOnly(startDate),
    endDateStr: todayDate
  };
};

export const enumerateDateRange = (startDate, endDate) => {
  const points = [];
  for (let cursor = new Date(startDate); cursor.getTime() <= endDate.getTime(); cursor = addUtcDays(cursor, 1)) {
    points.push(formatDateOnly(cursor));
  }
  return points;
};
