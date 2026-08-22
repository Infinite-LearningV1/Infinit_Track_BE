import { jest } from '@jest/globals';

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const loadAttendanceReads = async ({
  location = { location_id: 5 },
  activeAttendance = { id_attendance: 1, time_out: null },
  locationEventCreate
} = {}) => {
  jest.resetModules();

  const attendanceFindOne = jest.fn().mockResolvedValue(activeAttendance);
  const locationFindByPk = jest.fn().mockResolvedValue(location);
  const eventCreate = locationEventCreate || jest.fn().mockResolvedValue({ id: 99 });

  jest.unstable_mockModule('../src/config/database.js', () => ({
    default: { transaction: jest.fn() }
  }));

  jest.unstable_mockModule('../src/models/index.js', () => ({
    Attendance: {
      findOne: attendanceFindOne,
      findByPk: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn()
    },
    LocationEvent: { create: eventCreate },
    Location: { findByPk: locationFindByPk, findOne: jest.fn() },
    Booking: { findOne: jest.fn() },
    Settings: { findAll: jest.fn().mockResolvedValue([]), findOne: jest.fn() },
    AttendanceCategory: {},
    AttendanceStatus: {},
    BookingStatus: {},
    User: {},
    Role: {},
    Photo: {}
  }));

  jest.unstable_mockModule('../src/utils/geofence.js', () => ({
    calculateDistance: jest.fn(() => 0),
    getJakartaTime: jest.fn(() => new Date()),
    getJakartaDateString: jest.fn(() => '2026-07-28'),
    getCurrentTimeForDB: jest.fn(() => new Date()),
    toJakartaTime: jest.fn((d) => d)
  }));

  jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
    calculateWorkHour: jest.fn(() => 0),
    formatWorkHour: jest.fn(() => '00:00:00'),
    formatTimeOnly: jest.fn(() => '09:00')
  }));

  jest.unstable_mockModule('../src/jobs/autoCheckout.job.js', () => ({
    triggerAutoCheckout: jest.fn(),
    runSmartAutoCheckoutForDate: jest.fn()
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
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

  const mod = await import('../src/controllers/attendance.controller.js');
  return { ...mod, locationFindByPk, eventCreate };
};

const eventReq = (body = {}) => ({
  body: {
    event_type: 'ENTER',
    location_id: 5,
    event_timestamp: '2026-07-28T09:00:00+07:00',
    ...body
  },
  user: { id: 7, role_name: 'User' }
});

describe('logLocationEvent refusals', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * F31, characterized not fixed.
   *
   * These four refusals report their code in an `error` field. That is a third
   * convention in one codebase: `code: 'E_VALIDATION'` (validator, wfa),
   * the code embedded in the message string (updateUser, F27), and this.
   */
  it('rejects an unknown location with an error field, not a code field', async () => {
    const { logLocationEvent, eventCreate } = await loadAttendanceReads({ location: null });
    const res = buildRes();

    await logLocationEvent(eventReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual({
      success: false,
      message: 'Location ID tidak valid',
      error: 'INVALID_LOCATION_ID'
    });
    expect(body).not.toHaveProperty('code');
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it('rejects an unparseable timestamp', async () => {
    const { logLocationEvent, eventCreate } = await loadAttendanceReads();
    const res = buildRes();

    await logLocationEvent(eventReq({ event_timestamp: 'not-a-date' }), res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Format timestamp tidak valid',
      error: 'INVALID_TIMESTAMP'
    });
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it('refuses when the user has not checked in on the event date', async () => {
    const { logLocationEvent, eventCreate } = await loadAttendanceReads({
      activeAttendance: null
    });
    const res = buildRes();

    await logLocationEvent(eventReq(), res, jest.fn());

    expect(res.json.mock.calls[0][0]).toMatchObject({ error: 'NO_ACTIVE_SESSION' });
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it('refuses when the session has already been checked out', async () => {
    const { logLocationEvent, eventCreate } = await loadAttendanceReads({
      activeAttendance: { id_attendance: 1, time_out: '2026-07-28 17:00:00' }
    });
    const res = buildRes();

    await logLocationEvent(eventReq(), res, jest.fn());

    expect(res.json.mock.calls[0][0]).toMatchObject({ error: 'SESSION_ALREADY_ENDED' });
    expect(eventCreate).not.toHaveBeenCalled();
  });
});

describe('logLocationEvent success', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the event against the authenticated user, not a body-supplied id', async () => {
    const { logLocationEvent, eventCreate } = await loadAttendanceReads();

    await logLocationEvent(eventReq({ user_id: 999 }), buildRes(), jest.fn());

    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 7, location_id: 5, event_type: 'ENTER' })
    );
  });

  it('looks the attendance session up by the Jakarta date of the event', async () => {
    const mod = await loadAttendanceReads();
    const { Attendance } = await import('../src/models/index.js');

    // 2026-07-28T23:30:00Z is 2026-07-29 in Jakarta.
    await mod.logLocationEvent(
      eventReq({ event_timestamp: '2026-07-28T23:30:00Z' }),
      buildRes(),
      jest.fn()
    );

    expect(Attendance.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: 7, attendance_date: '2026-07-29' })
      })
    );
  });
});
