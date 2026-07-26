import { jest } from '@jest/globals';

/**
 * Characterization coverage for the two substantive attendance reads
 * (INF-252 Phase 0b).
 *
 * getAllAttendances is the busiest admin read and the one whose query shape
 * moves into a query object in Phase 2. logLocationEvent writes LocationEvent
 * and gates on attendance session state, so it is a mutation despite reading
 * like a log endpoint.
 *
 * Three findings came out of writing these, all recorded rather than fixed:
 * a validation guard that non-numeric input walks straight past (F30), a third
 * distinct error-code convention (F31), and the contrast between this endpoint's
 * pagination and getAllUsers having none at all (F20).
 */

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const attendanceRow = () => ({
  id_attendance: 1,
  user_id: 7,
  attendance_date: '2026-07-28',
  time_in: '2026-07-28 09:00:00',
  time_out: null,
  work_hour: 0,
  notes: null,
  user: { full_name: 'Nadia Putri', nip_nim: 'A12345' },
  attendance_category: { category_name: 'WFO' },
  attendance_status: { attendance_status_name: 'ON TIME' },
  location: null,
  booking: null
});

const loadAttendanceReads = async ({
  findAndCountAll = { count: 0, rows: [] },
  location = { location_id: 5 },
  activeAttendance = { id_attendance: 1, time_out: null },
  locationEventCreate
} = {}) => {
  jest.resetModules();

  const applySearch = jest.fn();
  const findAndCountAllFn = jest.fn().mockResolvedValue(findAndCountAll);
  const attendanceFindOne = jest.fn().mockResolvedValue(activeAttendance);
  const locationFindByPk = jest.fn().mockResolvedValue(location);
  const eventCreate = locationEventCreate || jest.fn().mockResolvedValue({ id: 99 });

  jest.unstable_mockModule('../src/config/database.js', () => ({
    default: { transaction: jest.fn() }
  }));

  jest.unstable_mockModule('../src/models/index.js', () => ({
    Attendance: {
      findAndCountAll: findAndCountAllFn,
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

  jest.unstable_mockModule('../src/utils/searchHelper.js', () => ({ applySearch }));

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
  return { ...mod, applySearch, findAndCountAllFn, locationFindByPk, eventCreate };
};

const listReq = (query = {}) => ({ query, user: { id: 1, role_name: 'Admin' } });

describe('getAllAttendances pagination', () => {
  beforeEach(() => jest.clearAllMocks());

  it('defaults to page 1 with 10 records', async () => {
    const { getAllAttendances, findAndCountAllFn } = await loadAttendanceReads();

    await getAllAttendances(listReq(), buildRes(), jest.fn());

    expect(findAndCountAllFn).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 0, distinct: true })
    );
  });

  it('computes the offset from page and limit', async () => {
    const { getAllAttendances, findAndCountAllFn } = await loadAttendanceReads();

    await getAllAttendances(listReq({ page: '3', limit: '25' }), buildRes(), jest.fn());

    expect(findAndCountAllFn).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 25, offset: 50 })
    );
  });

  it.each([
    ['page zero', { page: '0' }],
    ['negative page', { page: '-1' }],
    ['limit zero', { limit: '0' }],
    ['negative limit', { limit: '-5' }]
  ])('refuses %s', async (_name, query) => {
    const { getAllAttendances, findAndCountAllFn } = await loadAttendanceReads();
    const res = buildRes();

    await getAllAttendances(listReq(query), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Parameter page dan limit harus berupa angka positif'
    });
    expect(findAndCountAllFn).not.toHaveBeenCalled();
  });

  /**
   * F30, characterized not fixed.
   *
   * The guard is `pageNum < 1 || limitNum < 1`. parseInt('abc') is NaN, and
   * every comparison with NaN is false, so non-numeric input walks straight
   * past a check whose message promises "harus berupa angka positif" and
   * reaches Sequelize as NaN.
   */
  it('lets non-numeric page and limit past the positive-number guard', async () => {
    const { getAllAttendances, findAndCountAllFn } = await loadAttendanceReads();
    const res = buildRes();

    await getAllAttendances(listReq({ page: 'abc', limit: 'xyz' }), res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(400);
    const options = findAndCountAllFn.mock.calls[0][0];
    expect(Number.isNaN(options.limit)).toBe(true);
    expect(Number.isNaN(options.offset)).toBe(true);
  });

  it('returns the full pagination envelope', async () => {
    const { getAllAttendances } = await loadAttendanceReads({
      findAndCountAll: { count: 42, rows: [attendanceRow()] }
    });
    const res = buildRes();

    await getAllAttendances(listReq({ page: '2', limit: '10' }), res, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.message).toBe('Data absensi berhasil diambil');
    expect(body.pagination).toEqual({
      current_page: 2,
      total_pages: 5,
      total_records: 42,
      records_per_page: 10,
      has_next_page: true,
      has_prev_page: true
    });
  });

  it('reports no next page on the last page and no prev page on the first', async () => {
    const { getAllAttendances } = await loadAttendanceReads({
      findAndCountAll: { count: 5, rows: [] }
    });
    const res = buildRes();

    await getAllAttendances(listReq({ page: '1', limit: '10' }), res, jest.fn());

    expect(res.json.mock.calls[0][0].pagination).toMatchObject({
      total_pages: 1,
      has_next_page: false,
      has_prev_page: false
    });
  });
});

describe('getAllAttendances search', () => {
  beforeEach(() => jest.clearAllMocks());

  it('searches the joined user name and NIP only', async () => {
    const { getAllAttendances, applySearch } = await loadAttendanceReads();

    await getAllAttendances(listReq({ search: 'nadia' }), buildRes(), jest.fn());

    expect(applySearch).toHaveBeenCalledWith(expect.anything(), 'nadia', [
      '$user.full_name$',
      '$user.nip_nim$'
    ]);
  });

  it.each([['absent', {}], ['blank', { search: '   ' }]])(
    'applies no search when the term is %s',
    async (_name, query) => {
      const { getAllAttendances, applySearch } = await loadAttendanceReads();

      await getAllAttendances(listReq(query), buildRes(), jest.fn());

      expect(applySearch).not.toHaveBeenCalled();
    }
  );

  it('forwards a query failure to the error handler', async () => {
    const boom = new Error('db down');
    const mod = await loadAttendanceReads();
    mod.findAndCountAllFn.mockRejectedValueOnce(boom);
    const res = buildRes();
    const next = jest.fn();

    await mod.getAllAttendances(listReq(), res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});

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
