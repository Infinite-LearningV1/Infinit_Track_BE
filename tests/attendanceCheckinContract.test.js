import { jest } from '@jest/globals';

/**
 * Characterization coverage for checkIn controller behavior
 * (INF-252 Phase 0b).
 *
 * attendanceDuplicateSafety.test.js already covers the two 409 duplicate
 * paths. Everything else in this ~340-line function was unpinned: the
 * holiday/weekend gate, the working-hours window, the three per-category
 * location branches, the five WFA booking refusals, the status
 * classification, and the 201 payload.
 *
 * Determinism note: the controller derives the weekend/holiday decision from
 * a raw `new Date()` (line 683) rather than the Jakarta helpers it uses two
 * lines earlier, so the result depends on the day the suite happens to run.
 * These tests neutralise that by enabling both weekend and holiday check-in
 * in settings, and by mocking date-holidays.
 */

const settingRows = (overrides = {}) => {
  const base = {
    'checkin.start_time': '08:00:00',
    'checkin.end_time': '18:00:00',
    'checkin.late_time': '10:00:00',
    'workday.holiday_checkin_enabled': 'true',
    'workday.weekend_checkin_enabled': 'true',
    'workday.holiday_region': 'ID',
    ...overrides
  };
  return Object.entries(base).map(([setting_key, setting_value]) => ({
    setting_key,
    setting_value
  }));
};

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

/** Local-time constructor so getHours() is stable regardless of process TZ. */
const atJakartaClock = (hour, minute = 0) => new Date(2026, 6, 28, hour, minute, 0);

const wfoLocation = {
  location_id: 5,
  latitude: -0.89,
  longitude: 119.87,
  radius: 100
};

const loadCheckIn = async ({
  hour = 9,
  minute = 0,
  settings = settingRows(),
  existingAttendance = null,
  location = wfoLocation,
  booking = null,
  distance = 10,
  isHoliday = false,
  createdAttendance
} = {}) => {
  jest.resetModules();

  const txState = { committed: false };
  const commit = jest.fn().mockImplementation(async () => {
    txState.committed = true;
  });
  const rollback = jest.fn().mockImplementation(async () => {
    if (txState.committed) {
      throw new Error('Transaction cannot be rolled back because it has been finished');
    }
  });

  const attendanceCreate = jest.fn().mockResolvedValue({
    toJSON: () => createdAttendance ?? { id_attendance: 42, user_id: 1, category_id: 1 }
  });

  jest.unstable_mockModule('date-holidays', () => ({
    default: class {
      isHoliday() {
        return isHoliday;
      }
    }
  }));

  jest.unstable_mockModule('../src/config/database.js', () => ({
    default: { transaction: jest.fn().mockResolvedValue({ commit, rollback }) }
  }));

  jest.unstable_mockModule('../src/models/index.js', () => ({
    Attendance: {
      findOne: jest.fn().mockResolvedValue(existingAttendance),
      findByPk: jest.fn(),
      findAll: jest.fn(),
      create: attendanceCreate
    },
    Booking: { findOne: jest.fn().mockResolvedValue(booking) },
    Location: { findOne: jest.fn().mockResolvedValue(location) },
    Settings: { findAll: jest.fn().mockResolvedValue(settings), findOne: jest.fn() },
    AttendanceCategory: {},
    AttendanceStatus: {},
    BookingStatus: {},
    User: {},
    Role: {},
    LocationEvent: {},
    Photo: {}
  }));

  jest.unstable_mockModule('../src/utils/geofence.js', () => ({
    calculateDistance: jest.fn(() => distance),
    getJakartaTime: jest.fn(() => atJakartaClock(hour, minute)),
    getJakartaDateString: jest.fn(() => '2026-07-28'),
    getCurrentTimeForDB: jest.fn(() => new Date('2026-07-28T09:00:00+07:00')),
    toJakartaTime: jest.fn((d) => d)
  }));

  jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
    calculateWorkHour: jest.fn(() => 0),
    formatWorkHour: jest.fn(() => '00:00:00'),
    formatTimeOnly: jest.fn(() => '09:00')
  }));

  jest.unstable_mockModule('../src/utils/searchHelper.js', () => ({ applySearch: jest.fn() }));

  jest.unstable_mockModule('../src/jobs/autoCheckout.job.js', () => ({
    triggerAutoCheckout: jest.fn(),
    runSmartAutoCheckoutForDate: jest.fn()
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() }
  }));

  jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({ default: {} }));
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

  return { checkIn, commit, rollback, attendanceCreate };
};

const buildReq = (body = {}) => ({
  user: { id: 1 },
  body: { category_id: 1, latitude: -0.89, longitude: 119.87, notes: '', ...body }
});

describe('checkIn working-hours and calendar gates', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses a check-in before the configured start time', async () => {
    const { checkIn, commit, rollback } = await loadCheckIn({ hour: 7 });
    const res = buildRes();

    await checkIn(buildReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Check-in hanya bisa dilakukan pada jam 08:00 - 18:00.'
    });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it('refuses a check-in after the configured end time', async () => {
    const { checkIn } = await loadCheckIn({ hour: 19 });
    const res = buildRes();

    await checkIn(buildReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Check-in hanya bisa dilakukan pada jam 08:00 - 18:00.'
    });
  });

  it('refuses WFO on a holiday when holiday check-in is disabled', async () => {
    const { checkIn, rollback } = await loadCheckIn({
      isHoliday: true,
      settings: settingRows({
        'workday.holiday_checkin_enabled': 'false',
        'workday.weekend_checkin_enabled': 'false'
      })
    });
    const res = buildRes();

    await checkIn(buildReq({ category_id: 1 }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Check-in tidak diizinkan pada hari libur.'
    });
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('exempts WFA from the holiday gate entirely', async () => {
    const { checkIn } = await loadCheckIn({
      isHoliday: true,
      settings: settingRows({
        'workday.holiday_checkin_enabled': 'false',
        'workday.weekend_checkin_enabled': 'false'
      })
    });
    const res = buildRes();

    // No booking_id, so it falls through to the WFA-specific refusal rather
    // than the holiday one. That is the point: the gate was skipped.
    await checkIn(buildReq({ category_id: 3 }), res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Booking ID wajib untuk WFA.'
    });
  });
});

describe('checkIn WFO and WFH location validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 500 when no office location is configured', async () => {
    const { checkIn, rollback } = await loadCheckIn({ location: null });
    const res = buildRes();

    await checkIn(buildReq({ category_id: 1 }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Konfigurasi lokasi kantor (WFO) tidak ditemukan. Silakan hubungi admin.'
    });
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('refuses WFO outside the office radius', async () => {
    const { checkIn, rollback } = await loadCheckIn({ distance: 5000 });
    const res = buildRes();

    await checkIn(buildReq({ category_id: 1 }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('refuses WFH when the user has no registered home location', async () => {
    const { checkIn } = await loadCheckIn({ location: null });
    const res = buildRes();

    await checkIn(buildReq({ category_id: 2 }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('refuses WFH outside the home radius', async () => {
    const { checkIn } = await loadCheckIn({ distance: 5000 });
    const res = buildRes();

    await checkIn(buildReq({ category_id: 2 }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('checkIn WFA booking validation', () => {
  beforeEach(() => jest.clearAllMocks());

  const approvedBooking = {
    booking_id: 7,
    user_id: 1,
    status: 1,
    schedule_date: '2026-07-28',
    location: { latitude: -0.89, longitude: 119.87, radius: 150 }
  };

  it('requires a booking id', async () => {
    const { checkIn } = await loadCheckIn();
    const res = buildRes();

    await checkIn(buildReq({ category_id: 3 }), res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Booking ID wajib untuk WFA.'
    });
  });

  it('refuses an unknown booking', async () => {
    const { checkIn } = await loadCheckIn({ booking: null });
    const res = buildRes();

    await checkIn(buildReq({ category_id: 3, booking_id: 7 }), res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Booking tidak ditemukan.'
    });
  });

  it("refuses another user's booking", async () => {
    const { checkIn } = await loadCheckIn({
      booking: { ...approvedBooking, user_id: 99 }
    });
    const res = buildRes();

    await checkIn(buildReq({ category_id: 3, booking_id: 7 }), res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Booking tidak valid untuk user ini.'
    });
  });

  it('refuses a booking that is not approved', async () => {
    const { checkIn } = await loadCheckIn({
      booking: { ...approvedBooking, status: 3 }
    });
    const res = buildRes();

    await checkIn(buildReq({ category_id: 3, booking_id: 7 }), res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Booking belum disetujui.'
    });
  });

  it('refuses a booking scheduled for another day', async () => {
    const { checkIn } = await loadCheckIn({
      booking: { ...approvedBooking, schedule_date: '2026-07-27' }
    });
    const res = buildRes();

    await checkIn(buildReq({ category_id: 3, booking_id: 7 }), res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Booking tidak berlaku untuk hari ini.'
    });
  });

  it('refuses a check-in outside the booked location radius', async () => {
    const { checkIn } = await loadCheckIn({ booking: approvedBooking, distance: 9000 });
    const res = buildRes();

    await checkIn(buildReq({ category_id: 3, booking_id: 7 }), res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Anda berada di luar radius lokasi yang diizinkan.'
    });
  });
});

describe('checkIn success and status classification', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the record and returns 201 with ON TIME classification', async () => {
    const { checkIn, commit, rollback, attendanceCreate } = await loadCheckIn({ hour: 9 });
    const res = buildRes();
    const next = jest.fn();

    await checkIn(buildReq({ category_id: 1 }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();

    expect(attendanceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 1,
        category_id: 1,
        status_id: 1,
        attendance_date: '2026-07-28',
        work_hour: 0
      }),
      expect.objectContaining({ transaction: expect.anything() })
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.message).toBe('Check-in berhasil dengan status: ON TIME');
    expect(body.data.status_classification).toEqual({
      status_id: 1,
      status_label: 'ON TIME',
      check_in_time: '09:00',
      time_rules: { start_time: '08:00:00', late_time: '10:00:00' }
    });
  });

  it('classifies a check-in after the late threshold as LATE', async () => {
    const { checkIn, attendanceCreate } = await loadCheckIn({ hour: 11 });
    const res = buildRes();

    await checkIn(buildReq({ category_id: 1 }), res, jest.fn());

    expect(attendanceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ status_id: 2 }),
      expect.anything()
    );
    const body = res.json.mock.calls[0][0];
    expect(body.data.status_classification.status_label).toBe('LATE');
  });

  /**
   * DEAD BRANCH, characterized not fixed.
   *
   * The working-hours gate rejects anything earlier than checkin.start_time
   * with a 400, so the EARLY classification below it -- which tests the same
   * `currentTimeMinutes < checkinStartMinutes` condition -- can never run.
   * status_id 4 is therefore unreachable through check-in.
   *
   * If EARLY is meant to be reachable, the gate and the classifier disagree
   * and one of them is wrong. Recorded as F16.
   */
  it('never reaches the EARLY classification because the hours gate rejects first', async () => {
    const { checkIn, attendanceCreate } = await loadCheckIn({ hour: 7 });
    const res = buildRes();

    await checkIn(buildReq({ category_id: 1 }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(attendanceCreate).not.toHaveBeenCalled();
  });
});
