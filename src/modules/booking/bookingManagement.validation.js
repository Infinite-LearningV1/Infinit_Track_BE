import { query } from 'express-validator';

export const BOOKING_MANAGEMENT_LIST_QUERY_KEYS = [
  'page',
  'limit',
  'status',
  'user_id',
  'date_from',
  'date_to',
  'search',
  'sortBy',
  'sortOrder'
];

const MAX_LIMIT = 100;
const MAX_SAFE_BOOKING_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / MAX_LIMIT) + 1;
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

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};

const rejectUnknownKeys = query().custom((_value, { req }) => {
  const invalid = Object.keys(req.query ?? {}).find(
    (key) => !BOOKING_MANAGEMENT_LIST_QUERY_KEYS.includes(key)
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

export const validateBookingManagementListQuery = [
  rejectUnknownKeys,
  rejectNonScalarValues,
  rejectEmptyPaginationValues,
  query('page')
    .default(1)
    .custom((value) => isRawPositiveIntegerAtMost(value, MAX_SAFE_BOOKING_PAGE))
    .withMessage('page harus bilangan bulat >= 1')
    .toInt(),
  query('limit')
    .default(10)
    .isInt({ min: 1, max: MAX_LIMIT })
    .withMessage('limit harus bilangan bulat 1-100')
    .toInt(),
  query('status')
    .optional()
    .isString()
    .isIn(['pending', 'approved', 'rejected'])
    .withMessage('status harus pending, approved, atau rejected'),
  query('user_id')
    .optional()
    .custom((value) => isRawPositiveIntegerAtMost(value, MYSQL_SIGNED_INTEGER_MAX))
    .withMessage('user_id harus bilangan bulat positif')
    .toInt(),
  query('date_from')
    .optional()
    .isString()
    .custom(strictDateOnly)
    .withMessage('date_from harus tanggal valid YYYY-MM-DD'),
  query('date_to')
    .optional()
    .isString()
    .custom(strictDateOnly)
    .withMessage('date_to harus tanggal valid YYYY-MM-DD')
    .custom((value, { req }) => !req.query.date_from || req.query.date_from <= value)
    .withMessage('date_to tidak boleh sebelum date_from'),
  query('search').optional().isString().withMessage('search harus berupa teks').trim(),
  query('sortBy').optional().isString().withMessage('sortBy harus berupa teks'),
  query('sortOrder').optional().isString().withMessage('sortOrder harus berupa teks')
];
