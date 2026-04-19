import { jest } from '@jest/globals';

describe('attendance duplicate helper', () => {
  it('detects duplicate attendance unique constraint errors', async () => {
    const { isAttendanceDuplicateConstraintError } = await import(
      '../src/utils/attendanceDuplicateError.js'
    );

    const error = {
      name: 'SequelizeUniqueConstraintError',
      fields: { user_id: 1, attendance_date: '2026-04-14' },
      errors: [{ path: 'user_id' }, { path: 'attendance_date' }],
      parent: { code: 'ER_DUP_ENTRY' }
    };

    expect(isAttendanceDuplicateConstraintError(error)).toBe(true);
  });

  it('creates a 409 conflict error for request-driven paths', async () => {
    const { createAttendanceConflictError } = await import(
      '../src/utils/attendanceDuplicateError.js'
    );

    const err = createAttendanceConflictError();
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/attendance/i);
  });
});

describe('checkIn duplicate-safe behavior', () => {
  const buildReq = () => ({
    user: { id: 1 },
    body: { category_id: 1, latitude: -6.2, longitude: 106.8, notes: '' }
  });

  const buildRes = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns 409 when check-in pre-check finds existing attendance', async () => {
    const rollback = jest.fn();
    const commit = jest.fn();

    const mockedAttendance = {
      findOne: jest.fn().mockResolvedValueOnce({ id_attendance: 10 }),
      create: jest.fn()
    };

    jest.unstable_mockModule('../src/config/database.js', () => ({
      default: { transaction: jest.fn().mockResolvedValue({ rollback, commit }) }
    }));

    jest.unstable_mockModule('../src/models/index.js', () => ({
      Attendance: mockedAttendance,
      Booking: { findOne: jest.fn() },
      Location: { findOne: jest.fn() },
      Settings: { findAll: jest.fn() },
      AttendanceCategory: {},
      AttendanceStatus: {},
      BookingStatus: {},
      User: {},
      Role: {},
      LocationEvent: {}
    }));

    jest.unstable_mockModule('../src/utils/geofence.js', () => ({
      calculateDistance: jest.fn(() => 0),
      getJakartaTime: jest.fn(() => new Date('2026-04-14T09:00:00+07:00')),
      getJakartaDateString: jest.fn(() => '2026-04-14'),
      getCurrentTimeForDB: jest.fn(() => new Date('2026-04-14T09:00:00+07:00')),
      toJakartaTime: jest.fn((d) => d)
    }));

    jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
      formatWorkHour: jest.fn(),
      calculateWorkHour: jest.fn(),
      formatTimeOnly: jest.fn()
    }));

    jest.unstable_mockModule('../src/utils/searchHelper.js', () => ({
      applySearch: jest.fn()
    }));

    jest.unstable_mockModule('../src/jobs/autoCheckout.job.js', () => ({
      triggerAutoCheckout: jest.fn(),
      runSmartAutoCheckoutForDate: jest.fn()
    }));

    jest.unstable_mockModule('../src/utils/logger.js', () => ({
      default: { info: jest.fn(), error: jest.fn(), debug: jest.fn() }
    }));

    jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
      default: {}
    }));

    jest.unstable_mockModule('../src/analytics/fahp.extent.js', () => ({
      extentWeightsTFN: jest.fn(() => [0.4, 0.2, 0.2, 0.2])
    }));

    jest.unstable_mockModule('../src/analytics/fahp.js', () => ({
      defuzzifyMatrixTFN: jest.fn(() => []),
      computeCR: jest.fn(() => ({ CR: 0.05 }))
    }));

    jest.unstable_mockModule('../src/analytics/config.fahp.js', () => ({
      SMART_AC_PAIRWISE_TFN: []
    }));

    const { checkIn } = await import('../src/controllers/attendance.controller.js');

    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    await checkIn(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(rollback).toHaveBeenCalled();
  });

  it('returns 409 when create hits unique constraint after passing pre-check', async () => {
    const rollback = jest.fn();
    const commit = jest.fn();

    const mockedAttendance = {
      findOne: jest.fn().mockResolvedValueOnce(null),
      create: jest.fn().mockRejectedValueOnce({
        name: 'SequelizeUniqueConstraintError',
        fields: { user_id: 1, attendance_date: '2026-04-14' },
        errors: [{ path: 'user_id' }, { path: 'attendance_date' }],
        parent: { code: 'ER_DUP_ENTRY' }
      })
    };

    jest.unstable_mockModule('../src/config/database.js', () => ({
      default: { transaction: jest.fn().mockResolvedValue({ rollback, commit }) }
    }));

    jest.unstable_mockModule('../src/models/index.js', () => ({
      Attendance: mockedAttendance,
      Booking: { findOne: jest.fn() },
      Location: {
        findOne: jest.fn().mockResolvedValue({
          location_id: 1,
          latitude: -6.2,
          longitude: 106.8,
          radius: 100
        })
      },
      Settings: {
        findAll: jest.fn().mockResolvedValue([
          { setting_key: 'checkin.start_time', setting_value: '00:00:00' },
          { setting_key: 'checkin.end_time', setting_value: '23:59:59' },
          { setting_key: 'checkin.late_time', setting_value: '23:59:59' },
          { setting_key: 'workday.holiday_checkin_enabled', setting_value: 'true' },
          { setting_key: 'workday.weekend_checkin_enabled', setting_value: 'true' },
          { setting_key: 'workday.holiday_region', setting_value: 'ID' }
        ])
      },
      AttendanceCategory: {},
      AttendanceStatus: {},
      BookingStatus: {},
      User: {},
      Role: {},
      LocationEvent: {}
    }));

    jest.unstable_mockModule('../src/utils/geofence.js', () => ({
      calculateDistance: jest.fn(() => 0),
      getJakartaTime: jest.fn(() => new Date('2026-04-14T09:00:00+07:00')),
      getJakartaDateString: jest.fn(() => '2026-04-14'),
      getCurrentTimeForDB: jest.fn(() => new Date('2026-04-14T09:00:00+07:00')),
      toJakartaTime: jest.fn((d) => d)
    }));

    jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
      formatWorkHour: jest.fn(),
      calculateWorkHour: jest.fn(),
      formatTimeOnly: jest.fn()
    }));

    jest.unstable_mockModule('../src/utils/searchHelper.js', () => ({
      applySearch: jest.fn()
    }));

    jest.unstable_mockModule('../src/jobs/autoCheckout.job.js', () => ({
      triggerAutoCheckout: jest.fn(),
      runSmartAutoCheckoutForDate: jest.fn()
    }));

    jest.unstable_mockModule('../src/utils/logger.js', () => ({
      default: { info: jest.fn(), error: jest.fn(), debug: jest.fn() }
    }));

    jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
      default: {}
    }));

    jest.unstable_mockModule('../src/analytics/fahp.extent.js', () => ({
      extentWeightsTFN: jest.fn(() => [0.4, 0.2, 0.2, 0.2])
    }));

    jest.unstable_mockModule('../src/analytics/fahp.js', () => ({
      defuzzifyMatrixTFN: jest.fn(() => []),
      computeCR: jest.fn(() => ({ CR: 0.05 }))
    }));

    jest.unstable_mockModule('../src/analytics/config.fahp.js', () => ({
      SMART_AC_PAIRWISE_TFN: []
    }));

    const { checkIn } = await import('../src/controllers/attendance.controller.js');

    const req = buildReq();
    const res = buildRes();
    const next = jest.fn();

    await checkIn(req, res, next);

    expect(mockedAttendance.create).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalled();
  });
});

describe('job duplicate-safe behavior', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('treats duplicate createGeneralAlpha inserts as skipped, not errors', async () => {
    const mockedAttendance = {
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValueOnce(null),
      create: jest.fn().mockRejectedValueOnce({
        name: 'SequelizeUniqueConstraintError',
        fields: { user_id: 2, attendance_date: '2026-04-14' },
        errors: [{ path: 'user_id' }, { path: 'attendance_date' }],
        parent: { code: 'ER_DUP_ENTRY' }
      })
    };

    jest.unstable_mockModule('../src/models/index.js', () => ({
      User: { findAll: jest.fn().mockResolvedValue([{ id_users: 2 }]) },
      Role: {},
      Attendance: mockedAttendance,
      Booking: { findAll: jest.fn().mockResolvedValue([]) }
    }));

    const mockedLogger = { info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    jest.unstable_mockModule('../src/utils/logger.js', () => ({ default: mockedLogger }));
    jest.unstable_mockModule('../src/utils/jobHelper.js', () => ({
      executeJobWithTimeout: jest.fn()
    }));

    const { runGeneralAlphaForDate } = await import('../src/jobs/createGeneralAlpha.job.js');
    const result = await runGeneralAlphaForDate('2026-04-14');

    expect(result.error).toBeUndefined();
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it('treats duplicate resolveWfaBookings inserts as skipped, not errors', async () => {
    const mockedAttendance = {
      findOne: jest.fn().mockResolvedValueOnce(null),
      create: jest.fn().mockRejectedValueOnce({
        name: 'SequelizeUniqueConstraintError',
        fields: { user_id: 3, attendance_date: '2026-04-14' },
        errors: [{ path: 'user_id' }, { path: 'attendance_date' }],
        parent: { code: 'ER_DUP_ENTRY' }
      })
    };

    const mockedLogger = { info: jest.fn(), error: jest.fn(), debug: jest.fn() };

    jest.unstable_mockModule('../src/models/index.js', () => ({
      Booking: {
        findAll: jest
          .fn()
          .mockResolvedValueOnce([
            { user_id: 3, booking_id: 99, location_id: 1, schedule_date: '2026-04-14' }
          ])
          .mockResolvedValueOnce([])
      },
      Attendance: mockedAttendance
    }));

    jest.unstable_mockModule('../src/utils/logger.js', () => ({ default: mockedLogger }));
    jest.unstable_mockModule('../src/utils/jobHelper.js', () => ({
      executeJobWithTimeout: jest.fn()
    }));

    const { resolveWfaBookingsForDate } = await import('../src/jobs/resolveWfaBookings.job.js');
    const result = await resolveWfaBookingsForDate('2026-04-14');

    expect(result.success).toBe(true);
    expect(mockedLogger.error).not.toHaveBeenCalledWith(
      expect.stringMatching(/duplicate/i)
    );
  });
});
