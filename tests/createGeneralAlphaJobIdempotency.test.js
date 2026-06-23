import { jest } from '@jest/globals';

const mockUserFindAll = jest.fn();
const mockAttendanceFindAll = jest.fn();
const mockAttendanceBulkCreate = jest.fn();
const mockBookingFindAll = jest.fn();
const mockTransaction = jest.fn(async (callback) => callback('tx'));

jest.unstable_mockModule('../src/models/index.js', () => ({
  User: { findAll: mockUserFindAll },
  Role: {},
  Attendance: {
    findAll: mockAttendanceFindAll,
    bulkCreate: mockAttendanceBulkCreate
  },
  Booking: { findAll: mockBookingFindAll },
  sequelize: { transaction: mockTransaction }
}));

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: { transaction: mockTransaction }
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

jest.unstable_mockModule('../src/utils/attendanceDuplicateError.js', () => ({
  isAttendanceDuplicateConstraintError: jest.fn(() => false)
}));

const resetMocks = () => {
  jest.useRealTimers();
  jest.resetModules();
  mockUserFindAll.mockReset();
  mockAttendanceFindAll.mockReset();
  mockAttendanceBulkCreate.mockReset();
  mockBookingFindAll.mockReset();
  mockTransaction.mockClear();
  mockTransaction.mockImplementation(async (callback) => callback('tx'));
};

describe('createGeneralAlpha job idempotency and batching', () => {
  beforeEach(resetMocks);

  test('explicit-date dry-run rerun inserts only missing users with ignoreDuplicates', async () => {
    mockUserFindAll.mockResolvedValue([{ id_users: 1 }, { id_users: 2 }, { id_users: 3 }]);
    mockBookingFindAll.mockResolvedValue([{ user_id: 3 }]);
    mockAttendanceFindAll.mockResolvedValue([{ user_id: 1 }]);
    mockAttendanceBulkCreate.mockResolvedValue([{ user_id: 2 }]);

    const { runGeneralAlphaForDate } = await import('../src/jobs/createGeneralAlpha.job.js');
    const result = await runGeneralAlphaForDate('2026-05-29');

    expect(result).toEqual({ created: 1, skipped: 2, insertRowsRequested: 1 });
    expect(mockAttendanceFindAll).toHaveBeenCalledTimes(1);
    expect(mockAttendanceBulkCreate).toHaveBeenCalledTimes(1);
    const logger = (await import('../src/utils/logger.js')).default;
    expect(logger.info).toHaveBeenCalledWith(
      'Duplicate-safe general alpha insert completed. Requested: 1, created: 1, skipped: 2.'
    );
    expect(mockAttendanceBulkCreate).toHaveBeenCalledWith(
      [expect.objectContaining({ user_id: 2, attendance_date: '2026-05-29', status_id: 3 })],
      expect.objectContaining({ ignoreDuplicates: true, transaction: 'tx' })
    );
  });

  test('explicit-date rerun is idempotent when all candidates already have attendance', async () => {
    mockUserFindAll.mockResolvedValue([{ id_users: 1 }, { id_users: 2 }]);
    mockBookingFindAll.mockResolvedValue([]);
    mockAttendanceFindAll.mockResolvedValue([{ user_id: 1 }, { user_id: 2 }]);

    const { runGeneralAlphaForDate } = await import('../src/jobs/createGeneralAlpha.job.js');
    const result = await runGeneralAlphaForDate('2026-05-29');

    expect(result).toEqual({ created: 0, skipped: 2, insertRowsRequested: 0 });
    expect(mockAttendanceBulkCreate).not.toHaveBeenCalled();
  });

  test('deduplicates WFA skipped count to required users excluded by WFA', async () => {
    mockUserFindAll.mockResolvedValue([{ id_users: 1 }, { id_users: 2 }]);
    mockBookingFindAll.mockResolvedValue([{ user_id: 2 }, { user_id: 2 }, { user_id: 999 }]);
    mockAttendanceFindAll.mockResolvedValue([]);
    mockAttendanceBulkCreate.mockResolvedValue([{ user_id: 1 }]);

    const { runGeneralAlphaForDate } = await import('../src/jobs/createGeneralAlpha.job.js');
    const result = await runGeneralAlphaForDate('2026-05-29');

    expect(result).toEqual({ created: 1, skipped: 1, insertRowsRequested: 1 });
    expect(mockAttendanceBulkCreate).toHaveBeenCalledTimes(1);
  });

  test('manual trigger rethrows fatal batch failures after logging', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-29T12:00:00.000Z'));

    const fatalError = new Error('database unavailable');
    mockUserFindAll.mockRejectedValueOnce(fatalError);

    const { triggerCreateGeneralAlpha } = await import('../src/jobs/createGeneralAlpha.job.js');

    await expect(triggerCreateGeneralAlpha()).rejects.toThrow('database unavailable');
  });

  test('explicit-date run rethrows fatal failures after logging', async () => {
    const fatalError = new Error('database unavailable');
    mockUserFindAll.mockRejectedValueOnce(fatalError);

    const { runGeneralAlphaForDate } = await import('../src/jobs/createGeneralAlpha.job.js');

    await expect(runGeneralAlphaForDate('2026-05-29')).rejects.toThrow('database unavailable');
  });

  test('uses WIB working-day boundary and skips weekend target dates', async () => {
    const { runGeneralAlphaForDate } = await import('../src/jobs/createGeneralAlpha.job.js');
    const result = await runGeneralAlphaForDate('2026-05-30');

    expect(result).toEqual({ created: 0, skipped: 0, insertRowsRequested: 0 });
    expect(mockUserFindAll).not.toHaveBeenCalled();
    expect(mockAttendanceBulkCreate).not.toHaveBeenCalled();
  });
});
