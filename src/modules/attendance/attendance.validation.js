import { param, query } from 'express-validator';

export const ATTENDANCE_LIST_QUERY_KEYS = [
  'page', 'limit', 'search', 'from', 'to', 'mode', 'status',
  'checkout_state', 'sortBy', 'sortOrder'
];
export const ATTENDANCE_SORT_KEYS = [
  'attendance_date', 'time_in', 'time_out', 'full_name', 'status', 'created_at'
];
const MAX_LIMIT = 100;
const MAX_SAFE_ATTENDANCE_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / MAX_LIMIT) + 1;
const MYSQL_SIGNED_INTEGER_MAX = 2147483647;

const isRawPositiveIntegerAtMost = (value, maximum) => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 && value <= maximum;
  }
  if (typeof value !== 'string' || !/^\+?\d+$/.test(value)) return false;

  const parsed = BigInt(value);
  return parsed > 0n && parsed <= BigInt(maximum);
};

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

const rejectNonScalarValues = query().custom((_value, { req }) => {
  const invalid = Object.entries(req.query ?? {}).find(([, value]) => typeof value !== 'string');
  if (invalid) throw new Error(`Query parameter harus bernilai tunggal: ${invalid[0]}`);
  return true;
});

const rejectEmptyPaginationValues = query().custom((_value, { req }) => {
  const invalid = ['page', 'limit'].find((key) => req.query?.[key] === '');
  if (invalid) throw new Error(`${invalid} tidak boleh kosong`);
  return true;
});

export const validateAttendanceListQuery = [
  rejectUnknownKeys,
  rejectNonScalarValues,
  rejectEmptyPaginationValues,
  query('page').default(1)
    .custom((value) => isRawPositiveIntegerAtMost(value, MAX_SAFE_ATTENDANCE_PAGE))
    .withMessage('page harus bilangan bulat >= 1')
    .toInt(),
  query('limit').default(10).isInt({ min: 1, max: MAX_LIMIT }).withMessage('limit harus bilangan bulat 1-100').toInt(),
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
  param('id')
    .custom((value) => isRawPositiveIntegerAtMost(value, MYSQL_SIGNED_INTEGER_MAX))
    .withMessage('id harus bilangan bulat >= 1')
    .toInt()
];
