import { jest } from '@jest/globals';

describe('attendance duplicate contract', () => {
  it('matches the daily attendance truth fields regardless of order', async () => {
    const { matchesAttendanceDailyTruthFields } = await import(
      '../src/utils/attendanceDuplicateContract.js'
    );

    expect(matchesAttendanceDailyTruthFields(['attendance_date', 'user_id'])).toBe(true);
    expect(matchesAttendanceDailyTruthFields(['user_id'])).toBe(false);
    expect(matchesAttendanceDailyTruthFields(['booking_id', 'attendance_date'])).toBe(false);
  });

  it('builds a deterministic duplicate-safe job summary for known created count', async () => {
    const { buildDuplicateSafeJobSummary } = await import(
      '../src/utils/attendanceDuplicateContract.js'
    );

    expect(
      buildDuplicateSafeJobSummary({
        label: 'general alpha',
        requested: 2,
        skipped: 3,
        created: 2
      })
    ).toBe('Duplicate-safe general alpha insert completed. Requested: 2, created: 2, skipped: 3.');
  });

  it('builds a deterministic duplicate-safe job summary when created count is unavailable', async () => {
    const { buildDuplicateSafeJobSummary } = await import(
      '../src/utils/attendanceDuplicateContract.js'
    );

    expect(
      buildDuplicateSafeJobSummary({
        label: 'unused WFA alpha',
        requested: 1,
        skipped: 0,
        created: null
      })
    ).toBe(
      'Duplicate-safe unused WFA alpha insert completed. Requested: 1, skipped: 0, created count unavailable because ignoreDuplicates was used.'
    );
  });
});

describe('attendance duplicate helper', () => {
  it('detects duplicate attendance unique constraint errors from the uq_attendance_user_date key name', async () => {
    const { isAttendanceDuplicateConstraintError } = await import(
      '../src/utils/attendanceDuplicateError.js'
    );

    const error = {
      name: 'SequelizeUniqueConstraintError',
      fields: {},
      errors: [],
      parent: {
        code: 'ER_DUP_ENTRY',
        sqlMessage: "Duplicate entry '1-2026-04-14' for key 'uq_attendance_user_date'"
      }
    };

    expect(isAttendanceDuplicateConstraintError(error)).toBe(true);
  });

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
    expect(err.message).toBe('Anda sudah melakukan check-in hari ini.');
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

  it('uses the same duplicate-safe conflict message for pre-check and DB-race duplicates', async () => {
    const { ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE } = await import(
      '../src/utils/attendanceDuplicateContract.js'
    );

    expect(ATTENDANCE_ALREADY_CHECKED_IN_MESSAGE).toBe('Anda sudah melakukan check-in hari ini.');
  });

  it('returns 409 when check-in pre-check finds existing attendance', async () => {
    const rollback = jest.fn();
    const commit = jest.fn();
    const duplicateMessage = 'Anda sudah melakukan check-in hari ini.';

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
      LocationEvent: {},
      Photo: {}
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
      expect.objectContaining({
        success: false,
        message: duplicateMessage
      })
    );
    expect(rollback).toHaveBeenCalled();
  });

  it('returns 409 when create hits unique constraint after passing pre-check', async () => {
    const rollback = jest.fn();
    const commit = jest.fn();
    const duplicateMessage = 'Anda sudah melakukan check-in hari ini.';

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
      LocationEvent: {},
      Photo: {}
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
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: duplicateMessage
      })
    );
    expect(next).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalled();
  });

  it.each([
    ['WFO', 1],
    ['WFH', 2]
  ])('includes work_hour default when creating %s check-in attendance', async (_label, categoryId) => {
    const rollback = jest.fn();
    const commit = jest.fn();

    const mockedAttendance = {
      findOne: jest.fn().mockResolvedValueOnce(null),
      create: jest.fn().mockResolvedValueOnce({
        toJSON: () => ({ id_attendance: 10 })
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
      LocationEvent: {},
      Photo: {}
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
    req.body.category_id = categoryId;
    const res = buildRes();
    const next = jest.fn();

    await checkIn(req, res, next);

    expect(mockedAttendance.create).toHaveBeenCalledWith(
      expect.objectContaining({ work_hour: 0 }),
      expect.objectContaining({ transaction: expect.any(Object) })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(commit).toHaveBeenCalled();
  });
  it('passes rollback failure to next when pre-check duplicate rollback rejects', async () => {
    const rollbackError = new Error('rollback failed');
    const rollback = jest.fn().mockRejectedValueOnce(rollbackError);
    const commit = jest.fn();

    jest.unstable_mockModule('../src/config/database.js', () => ({
      default: { transaction: jest.fn().mockResolvedValue({ rollback, commit }) }
    }));

    jest.unstable_mockModule('../src/models/index.js', () => ({
      Attendance: {
        findOne: jest.fn().mockResolvedValueOnce({ id_attendance: 10 }),
        create: jest.fn()
      },
      Booking: { findOne: jest.fn() },
      Location: { findOne: jest.fn() },
      Settings: { findAll: jest.fn() },
      AttendanceCategory: {},
      AttendanceStatus: {},
      BookingStatus: {},
      User: {},
      Role: {},
      LocationEvent: {},
      Photo: {}
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

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(rollbackError);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('passes rollback failure to next when unique-constraint duplicate rollback rejects', async () => {
    const rollbackError = new Error('rollback failed');
    const rollback = jest.fn().mockRejectedValueOnce(rollbackError);
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
      LocationEvent: {},
      Photo: {}
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

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(rollbackError);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('passes transaction start failure to next', async () => {
    const transactionError = new Error('transaction start failed');

    jest.unstable_mockModule('../src/config/database.js', () => ({
      default: {
        transaction: jest.fn().mockRejectedValueOnce(transactionError),
        define: jest.fn(() => ({}))
      }
    }));

    jest.unstable_mockModule('../src/models/index.js', () => ({
      Attendance: { findOne: jest.fn(), create: jest.fn() },
      Booking: { findOne: jest.fn() },
      Location: { findOne: jest.fn() },
      Settings: { findAll: jest.fn() },
      AttendanceCategory: {},
      AttendanceStatus: {},
      BookingStatus: {},
      User: {},
      Role: {},
      LocationEvent: {},
      Photo: {}
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

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(transactionError);
  });

  it('passes rollback failure to next when time-window validation rollback rejects', async () => {
    const rollbackError = new Error('rollback failed');
    const rollback = jest.fn().mockRejectedValueOnce(rollbackError);
    const commit = jest.fn();

    jest.unstable_mockModule('../src/config/database.js', () => ({
      default: { transaction: jest.fn().mockResolvedValue({ rollback, commit }) }
    }));

    jest.unstable_mockModule('../src/models/index.js', () => ({
      Attendance: {
        findOne: jest.fn().mockResolvedValueOnce(null),
        create: jest.fn()
      },
      Booking: { findOne: jest.fn() },
      Location: { findOne: jest.fn() },
      Settings: {
        findAll: jest.fn().mockResolvedValue([
          { setting_key: 'checkin.start_time', setting_value: '08:00:00' },
          { setting_key: 'checkin.end_time', setting_value: '18:00:00' },
          { setting_key: 'checkin.late_time', setting_value: '10:00:00' },
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
      LocationEvent: {},
      Photo: {}
    }));

    jest.unstable_mockModule('../src/utils/geofence.js', () => ({
      calculateDistance: jest.fn(() => 0),
      getJakartaTime: jest.fn(() => new Date('2026-04-14T07:00:00+07:00')),
      getJakartaDateString: jest.fn(() => '2026-04-14'),
      getCurrentTimeForDB: jest.fn(() => new Date('2026-04-14T07:00:00+07:00')),
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

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(rollbackError);
    expect(rollback).toHaveBeenCalledTimes(1);
  });
});

describe('job duplicate-safe behavior', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('treats duplicate createGeneralAlpha inserts as skipped, not errors', async () => {
    const mockedAttendance = {
      findAll: jest.fn().mockResolvedValue([{ user_id: 2 }]),
      bulkCreate: jest.fn()
    };
    const mockedTransaction = jest.fn(async (callback) => callback('tx'));

    jest.unstable_mockModule('../src/models/index.js', () => ({
      User: { findAll: jest.fn().mockResolvedValue([{ id_users: 2 }]) },
      Role: {},
      Attendance: mockedAttendance,
      Booking: { findAll: jest.fn().mockResolvedValue([]) }
    }));
    jest.unstable_mockModule('../src/config/database.js', () => ({
      default: { transaction: mockedTransaction }
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
    expect(result.insertRowsRequested).toBe(0);
  });

  it('uses transactional bulkCreate ignoreDuplicates for unresolved WFA booking candidates', async () => {
    const mockedAttendance = {
      findAll: jest.fn().mockResolvedValueOnce([]),
      bulkCreate: jest.fn().mockResolvedValueOnce([])
    };
    const mockedTransaction = jest.fn(async (callback) => callback('tx'));

    const mockedLogger = { info: jest.fn(), error: jest.fn(), debug: jest.fn() };

    jest.unstable_mockModule('../src/config/database.js', () => ({
      default: { transaction: mockedTransaction }
    }));

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

    expect(result).toEqual({ success: true, targetDate: '2026-04-14' });
    expect(mockedTransaction).toHaveBeenCalledTimes(1);
    expect(mockedAttendance.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: ['user_id'],
        where: expect.objectContaining({ attendance_date: '2026-04-14' }),
        transaction: 'tx'
      })
    );
    expect(mockedAttendance.bulkCreate).toHaveBeenCalledTimes(1);
    expect(mockedAttendance.bulkCreate).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          user_id: 3,
          category_id: 3,
          status_id: 3,
          location_id: 1,
          booking_id: 99,
          work_hour: 0,
          attendance_date: '2026-04-14'
        })
      ],
      expect.objectContaining({ ignoreDuplicates: true, transaction: 'tx' })
    );
    expect(mockedLogger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('Alpha records created')
    );
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'Task A completed. Alpha insert rows requested: 1, Pre-insert skipped: 0. Actual created count unavailable with ignoreDuplicates.'
    );
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });
});

describe('createGeneralAlpha duplicate-safe batch behavior', () => {
  const mockGeneralAlphaModules = ({ users, bookings = [], attendances = [] }) => {
    const mockedUserFindAll = jest.fn().mockResolvedValue(users);
    const mockedBookingFindAll = jest.fn().mockResolvedValue(bookings);
    const mockedAttendanceFindAll = jest.fn().mockResolvedValue(attendances);
    const mockedAttendanceBulkCreate = jest.fn().mockResolvedValue([]);
    const mockedTransaction = jest.fn(async (callback) => callback('tx'));

    jest.unstable_mockModule('../src/config/database.js', () => ({
      default: { transaction: mockedTransaction }
    }));

    jest.unstable_mockModule('../src/models/index.js', () => ({
      User: { findAll: mockedUserFindAll },
      Role: {},
      Attendance: {
        findAll: mockedAttendanceFindAll,
        bulkCreate: mockedAttendanceBulkCreate
      },
      Booking: { findAll: mockedBookingFindAll }
    }));

    jest.unstable_mockModule('../src/utils/logger.js', () => ({
      default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
    }));

    return {
      mockedAttendanceFindAll,
      mockedAttendanceBulkCreate,
      mockedTransaction
    };
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('uses bulkCreate ignoreDuplicates when missing candidates race with duplicate insert', async () => {
    const { mockedAttendanceFindAll, mockedAttendanceBulkCreate } = mockGeneralAlphaModules({
      users: [{ id_users: 1 }, { id_users: 2 }],
      attendances: []
    });

    const { runGeneralAlphaForDate } = await import('../src/jobs/createGeneralAlpha.job.js');
    const result = await runGeneralAlphaForDate('2026-05-29');

    expect(result).toEqual({ created: 0, skipped: 0, insertRowsRequested: 2 });
    expect(mockedAttendanceFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ attendance_date: '2026-05-29' }),
        transaction: 'tx'
      })
    );
    expect(mockedAttendanceBulkCreate).toHaveBeenCalledTimes(1);
    expect(mockedAttendanceBulkCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ user_id: 1, attendance_date: '2026-05-29' }),
        expect.objectContaining({ user_id: 2, attendance_date: '2026-05-29' })
      ]),
      expect.objectContaining({ ignoreDuplicates: true, transaction: 'tx' })
    );
  });

  it('does not call bulkCreate on idempotent rerun when all candidates already exist', async () => {
    const { mockedAttendanceBulkCreate } = mockGeneralAlphaModules({
      users: [{ id_users: 1 }, { id_users: 2 }],
      attendances: [{ user_id: 1 }, { user_id: 2 }]
    });

    const { runGeneralAlphaForDate } = await import('../src/jobs/createGeneralAlpha.job.js');
    const result = await runGeneralAlphaForDate('2026-05-29');

    expect(result).toEqual({ created: 0, skipped: 2, insertRowsRequested: 0 });
    expect(mockedAttendanceBulkCreate).not.toHaveBeenCalled();
  });
});
