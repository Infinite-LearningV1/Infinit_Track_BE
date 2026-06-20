import { jest } from '@jest/globals';

const mockBookingFindAll = jest.fn();
const mockAttendanceFindAll = jest.fn();
const mockAttendanceBulkCreate = jest.fn();
const mockTransaction = jest.fn(async (callback) => callback('tx'));
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
};

jest.unstable_mockModule('../src/models/index.js', () => ({
  Booking: { findAll: mockBookingFindAll },
  Attendance: {
    findAll: mockAttendanceFindAll,
    bulkCreate: mockAttendanceBulkCreate
  }
}));

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: { transaction: mockTransaction }
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: mockLogger
}));

jest.unstable_mockModule('../src/utils/attendanceDuplicateError.js', () => ({
  isAttendanceDuplicateConstraintError: jest.fn(() => false)
}));

const booking = ({ bookingId, userId, locationId = 100, scheduleDate = '2026-05-29' }) => ({
  booking_id: bookingId,
  user_id: userId,
  location_id: locationId,
  schedule_date: scheduleDate,
  update: jest.fn()
});

describe('resolveWfaBookings job idempotency and batching', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.resetModules();
    mockBookingFindAll.mockReset();
    mockAttendanceFindAll.mockReset();
    mockAttendanceBulkCreate.mockReset();
    mockLogger.info.mockClear();
    mockLogger.error.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.debug.mockClear();
    mockTransaction.mockClear();
    mockTransaction.mockImplementation(async (callback) => callback('tx'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('explicit-date resolver inserts unused approved WFA bookings with ignoreDuplicates', async () => {
    mockBookingFindAll
      .mockResolvedValueOnce([
        booking({ bookingId: 1, userId: 10 }),
        booking({ bookingId: 2, userId: 11 })
      ])
      .mockResolvedValueOnce([]);
    mockAttendanceFindAll.mockResolvedValue([{ user_id: 10 }]);
    mockAttendanceBulkCreate.mockResolvedValue([{ user_id: 11 }]);

    const { resolveWfaBookingsForDate } = await import('../src/jobs/resolveWfaBookings.job.js');
    const result = await resolveWfaBookingsForDate('2026-05-29');

    expect(result).toEqual({ success: true, targetDate: '2026-05-29' });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockAttendanceFindAll).toHaveBeenCalledTimes(1);
    expect(mockAttendanceFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: ['user_id'],
        where: expect.objectContaining({ attendance_date: '2026-05-29' }),
        transaction: 'tx'
      })
    );
    expect(mockAttendanceBulkCreate).toHaveBeenCalledTimes(1);
    expect(mockAttendanceBulkCreate).toHaveBeenCalledWith(
      [expect.objectContaining({ user_id: 11, booking_id: 2, attendance_date: '2026-05-29', status_id: 3 })],
      expect.objectContaining({ ignoreDuplicates: true, transaction: 'tx' })
    );
  });

  test('explicit-date resolver reports duplicate-ignored WFA inserts as requested but not created', async () => {
    mockBookingFindAll
      .mockResolvedValueOnce([booking({ bookingId: 3, userId: 12 })])
      .mockResolvedValueOnce([]);
    mockAttendanceFindAll.mockResolvedValue([]);
    mockAttendanceBulkCreate.mockResolvedValue([]);

    const { resolveWfaBookingsForDate } = await import('../src/jobs/resolveWfaBookings.job.js');
    const result = await resolveWfaBookingsForDate('2026-05-29');

    expect(result).toEqual({ success: true, targetDate: '2026-05-29' });
    expect(mockAttendanceBulkCreate).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('Alpha records created')
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Task A completed. Alpha insert rows requested: 1, Pre-insert skipped: 0. Actual created count unavailable with ignoreDuplicates.'
    );
  });

  test('explicit-date rerun is idempotent when all approved WFA bookings already have attendance', async () => {
    mockBookingFindAll
      .mockResolvedValueOnce([
        booking({ bookingId: 1, userId: 10 }),
        booking({ bookingId: 2, userId: 11 })
      ])
      .mockResolvedValueOnce([]);
    mockAttendanceFindAll.mockResolvedValue([{ user_id: 10 }, { user_id: 11 }]);

    const { resolveWfaBookingsForDate } = await import('../src/jobs/resolveWfaBookings.job.js');
    const result = await resolveWfaBookingsForDate('2026-05-29');

    expect(result).toEqual({ success: true, targetDate: '2026-05-29' });
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockAttendanceFindAll).toHaveBeenCalledTimes(1);
    expect(mockAttendanceBulkCreate).not.toHaveBeenCalled();
  });

  test('scheduled resolver computes H-1 target date from Jakarta time', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-30T16:55:00.000Z'));
    mockBookingFindAll.mockResolvedValue([]);
    mockAttendanceFindAll.mockResolvedValue([]);

    const { resolveWfaBookingsJob } = await import('../src/jobs/resolveWfaBookings.job.js');
    await resolveWfaBookingsJob();

    expect(mockBookingFindAll.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ schedule_date: '2026-05-29', status: 1 })
    );
  });

  test('explicit-date resolver reports failure when expired pending Booking.findAll fails after Task A succeeds', async () => {
    const taskBFailure = new Error('expired pending query failed');
    mockBookingFindAll
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(taskBFailure);
    mockAttendanceFindAll.mockResolvedValue([]);

    const { resolveWfaBookingsForDate } = await import('../src/jobs/resolveWfaBookings.job.js');
    const result = await resolveWfaBookingsForDate('2026-05-29');

    expect(mockBookingFindAll).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ success: false, error: 'expired pending query failed' });
  });

  test('scheduled resolver rejects when expired pending Booking.findAll fails after Task A succeeds', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-30T16:55:00.000Z'));
    const taskBFailure = new Error('expired pending query failed');
    mockBookingFindAll
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(taskBFailure);
    mockAttendanceFindAll.mockResolvedValue([]);

    const { resolveWfaBookingsJob } = await import('../src/jobs/resolveWfaBookings.job.js');

    await expect(resolveWfaBookingsJob()).rejects.toThrow('expired pending query failed');
    expect(mockBookingFindAll).toHaveBeenCalledTimes(2);
  });

  test('explicit-date resolver attempts all expired pending updates then reports partial update failure', async () => {
    const firstExpiredBooking = booking({ bookingId: 201, userId: 21, scheduleDate: '2026-05-27' });
    const secondExpiredBooking = booking({ bookingId: 202, userId: 22, scheduleDate: '2026-05-28' });
    const thirdExpiredBooking = booking({ bookingId: 203, userId: 23, scheduleDate: '2026-05-28' });
    secondExpiredBooking.update.mockRejectedValue(new Error('booking update failed'));
    mockBookingFindAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([firstExpiredBooking, secondExpiredBooking, thirdExpiredBooking]);
    mockAttendanceFindAll.mockResolvedValue([]);

    const { resolveWfaBookingsForDate } = await import('../src/jobs/resolveWfaBookings.job.js');
    const result = await resolveWfaBookingsForDate('2026-05-29');

    expect(firstExpiredBooking.update).toHaveBeenCalledTimes(1);
    expect(secondExpiredBooking.update).toHaveBeenCalledTimes(1);
    expect(thirdExpiredBooking.update).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to reject 1 expired pending WFA booking');
  });

  test('explicit-date resolver rejects expired pending bookings after Task A bulkCreate fails and reports failure', async () => {
    const expiredBooking = booking({ bookingId: 99, userId: 12, scheduleDate: '2026-05-28' });
    const taskAFailure = new Error('bulk insert failed');
    mockBookingFindAll
      .mockResolvedValueOnce([booking({ bookingId: 1, userId: 10 })])
      .mockResolvedValueOnce([expiredBooking]);
    mockAttendanceFindAll.mockResolvedValue([]);
    mockAttendanceBulkCreate.mockRejectedValue(taskAFailure);

    const { resolveWfaBookingsForDate } = await import('../src/jobs/resolveWfaBookings.job.js');
    const result = await resolveWfaBookingsForDate('2026-05-29');

    expect(expiredBooking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 2,
        processed_at: expect.any(Date),
        approved_by: null,
        updated_at: expect.any(Date)
      })
    );
    expect(result).toEqual({ success: false, error: 'bulk insert failed' });
  });

  test('scheduled resolver rejects expired pending bookings after Task A bulkCreate fails and rejects', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-30T16:55:00.000Z'));
    const expiredBooking = booking({ bookingId: 100, userId: 13, scheduleDate: '2026-05-28' });
    const taskAFailure = new Error('bulk insert failed');
    mockBookingFindAll
      .mockResolvedValueOnce([booking({ bookingId: 2, userId: 11 })])
      .mockResolvedValueOnce([expiredBooking]);
    mockAttendanceFindAll.mockResolvedValue([]);
    mockAttendanceBulkCreate.mockRejectedValue(taskAFailure);

    const { resolveWfaBookingsJob } = await import('../src/jobs/resolveWfaBookings.job.js');

    await expect(resolveWfaBookingsJob()).rejects.toThrow('bulk insert failed');
    expect(expiredBooking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 2,
        processed_at: expect.any(Date),
        approved_by: null,
        updated_at: expect.any(Date)
      })
    );
  });
});
