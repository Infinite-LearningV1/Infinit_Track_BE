import { Op } from 'sequelize';

import Booking from '../models/booking.model.js';
import { AppError } from '../shared/errors/AppError.js';
import { getJakartaDateString } from '../utils/geofence.js';

const wfaError = (message, code, status = 400, field = 'schedule_date') =>
  new AppError(message, {
    code,
    status,
    details: field ? [{ field, code }] : []
  });

export const parseStrictScheduleDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw wfaError('Tanggal WFA harus menggunakan format YYYY-MM-DD.', 'INVALID_SCHEDULE_DATE');
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw wfaError('Tanggal WFA tidak valid.', 'INVALID_SCHEDULE_DATE');
  }

  return value;
};

export const assertFutureWibScheduleDate = (value, { today = getJakartaDateString() } = {}) => {
  const scheduleDate = parseStrictScheduleDate(value);

  if (scheduleDate < today) {
    throw wfaError('Tanggal booking tidak boleh di masa lalu.', 'PAST_DATE_NOT_ALLOWED');
  }

  if (scheduleDate === today) {
    throw wfaError('Booking di hari yang sama tidak diperbolehkan.', 'SAME_DAY_NOT_ALLOWED');
  }

  return scheduleDate;
};

export const findActiveDuplicateBooking = ({ userId, scheduleDate, transaction = null }) =>
  Booking.findOne({
    where: {
      user_id: userId,
      schedule_date: scheduleDate,
      status: { [Op.in]: [1, 3] }
    },
    transaction
  });

export const assertWfaEligibility = async ({
  userId,
  scheduleDate,
  checkDuplicate = true,
  transaction = null
}) => {
  const eligibleScheduleDate = assertFutureWibScheduleDate(scheduleDate);

  if (!checkDuplicate) {
    return eligibleScheduleDate;
  }

  const duplicateBooking = await findActiveDuplicateBooking({
    userId,
    scheduleDate: eligibleScheduleDate,
    transaction
  });

  if (duplicateBooking) {
    throw wfaError(
      'Anda sudah memiliki booking pada tanggal tersebut.',
      'DUPLICATE_BOOKING',
      409
    );
  }

  return eligibleScheduleDate;
};
