import { jest } from '@jest/globals';

/**
 * Characterization coverage for checkOut controller behavior
 * (INF-252 Phase 0b).
 *
 * POST /api/attendance/checkout/:id mutates final attendance state and had no
 * behavioral test of any kind. Routing and authorization are pinned by
 * attendanceRouteContract.test.js; this file pins what the controller itself
 * does -- ownership, double-checkout refusal, geofence acceptance across WFO /
 * WFH / WFA, the transaction lifecycle, and the success payload.
 *
 * These describe behavior as it exists today, including behavior that is
 * arguably wrong. Two defects were found while reading the controller and are
 * recorded in docs/architecture/api-contract-inventory.md rather than fixed
 * here: a rollback-after-commit path, and nine console.log calls in a
 * final-state mutation. Fixing either belongs in its own PR.
 */

const FIXED_TIME_OUT = new Date('2026-04-14T17:00:00+07:00');

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const buildAttendance = (overrides = {}) => ({
  id_attendance: 10,
  user_id: 1,
  time_in: '2026-04-14 09:00:00',
  time_out: null,
  attendance_date: '2026-04-14',
  category_id: 1,
  status_id: 1,
  location_id: 5,
  booking_id: null,
  notes: null,
  update: jest.fn().mockResolvedValue(undefined),
  ...overrides
});

const wfoLocation = { id_location: 5, latitude: -0.89, longitude: 119.87, radius: 100 };

/**
 * Loads the controller with every external dependency mocked.
 * Returns the controller plus the mocks the tests assert against.
 */
const loadCheckOut = async ({
  attendanceRecords = [buildAttendance()],
  updatedAttendance,
  wfo = wfoLocation,
  wfh = null,
  booking = null,
  distance = 10
} = {}) => {
  jest.resetModules();

  // Mirror Sequelize: rolling back an already-committed transaction throws.
  // Without this fidelity the rollback-after-commit defect below is invisible.
  const txState = { committed: false };
  const commit = jest.fn().mockImplementation(async () => {
    txState.committed = true;
  });
  const rollback = jest.fn().mockImplementation(async () => {
    if (txState.committed) {
      throw new Error(
        'Transaction cannot be rolled back because it has been finished with state: commit'
      );
    }
  });

  const findByPk = jest.fn();
  attendanceRecords.forEach((record) => findByPk.mockResolvedValueOnce(record));
  // Explicit undefined check, not ??-fallback: a test that deliberately passes
  // null for the post-commit refetch must actually get null back.
  findByPk.mockResolvedValue(
    updatedAttendance === undefined ? attendanceRecords[0] : updatedAttendance
  );

  const locationFindOne = jest.fn().mockResolvedValueOnce(wfo).mockResolvedValueOnce(wfh);
  const bookingFindOne = jest.fn().mockResolvedValue(booking);

  jest.unstable_mockModule('../src/config/database.js', () => ({
    default: { transaction: jest.fn().mockResolvedValue({ commit, rollback }) }
  }));

  jest.unstable_mockModule('../src/models/index.js', () => ({
    Attendance: { findByPk, findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() },
    Booking: { findOne: bookingFindOne },
    Location: { findOne: locationFindOne },
    Settings: { findAll: jest.fn(), findOne: jest.fn() },
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
    getJakartaTime: jest.fn(() => new Date('2026-04-14T17:00:00+07:00')),
    getJakartaDateString: jest.fn(() => '2026-04-14'),
    getCurrentTimeForDB: jest.fn(() => FIXED_TIME_OUT),
    toJakartaTime: jest.fn((d) => d)
  }));

  jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
    calculateWorkHour: jest.fn(() => 8),
    formatWorkHour: jest.fn(() => '08:00:00'),
    formatTimeOnly: jest.fn((value) => (value === null || value === undefined ? null : '09:00'))
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

  const { checkOut } = await import('../src/controllers/attendance.controller.js');

  return { checkOut, commit, rollback, findByPk, locationFindOne, bookingFindOne };
};

const buildReq = (overrides = {}) => ({
  params: { id: '10' },
  user: { id: 1 },
  body: { latitude: -0.89, longitude: 119.87 },
  ...overrides
});

describe('checkOut refusals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 404 and rolls back when the attendance record does not exist', async () => {
    const { checkOut, commit, rollback } = await loadCheckOut({ attendanceRecords: [null] });
    const res = buildRes();

    await checkOut(buildReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Data attendance tidak ditemukan'
    });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it('returns 403 when the record belongs to another user', async () => {
    const { checkOut, commit, rollback } = await loadCheckOut({
      attendanceRecords: [buildAttendance({ user_id: 2 })]
    });
    const res = buildRes();

    await checkOut(buildReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Anda tidak memiliki akses untuk melakukan check-out pada data ini'
    });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it('returns 400 when the user has already checked out', async () => {
    const { checkOut, commit, rollback } = await loadCheckOut({
      attendanceRecords: [buildAttendance({ time_out: '2026-04-14 17:00:00' })]
    });
    const res = buildRes();

    await checkOut(buildReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Anda sudah melakukan check-out hari ini.'
    });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it('returns 400 when the user is outside every valid radius', async () => {
    const { checkOut, commit, rollback } = await loadCheckOut({ distance: 5000 });
    const res = buildRes();

    await checkOut(buildReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Anda berada di luar radius lokasi yang diizinkan untuk check-out.'
    });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it('returns 400 when no valid location exists at all', async () => {
    const { checkOut, rollback } = await loadCheckOut({ wfo: null, wfh: null, booking: null });
    const res = buildRes();

    await checkOut(buildReq(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(rollback).toHaveBeenCalledTimes(1);
  });
});

describe('checkOut success path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('commits, then returns the documented payload', async () => {
    const attendance = buildAttendance();
    const updated = {
      ...buildAttendance(),
      time_out: '2026-04-14 17:00:00',
      work_hour: 8
    };

    const { checkOut, commit, rollback } = await loadCheckOut({
      attendanceRecords: [attendance],
      updatedAttendance: updated
    });
    const res = buildRes();
    const next = jest.fn();

    await checkOut(buildReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();

    expect(attendance.update).toHaveBeenCalledWith(
      { time_out: FIXED_TIME_OUT, work_hour: 8 },
      expect.objectContaining({ transaction: expect.anything() })
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Check-out berhasil',
      data: {
        id_attendance: 10,
        attendance_date: '2026-04-14',
        time_in: '09:00',
        time_out: '09:00',
        work_hour: '08:00:00',
        user_id: 1,
        category_id: 1,
        status_id: 1,
        location_id: 5,
        booking_id: null,
        notes: null
      }
    });
  });

  it('accepts an approved WFA booking location when no WFO or WFH location matches', async () => {
    const bookingLocation = { id_location: 77, latitude: -0.9, longitude: 119.9, radius: 150 };

    const { checkOut, commit, bookingFindOne } = await loadCheckOut({
      wfo: null,
      wfh: null,
      booking: { id_booking: 3, location: bookingLocation },
      distance: 20
    });
    const res = buildRes();

    await checkOut(buildReq(), res, jest.fn());

    expect(bookingFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: 1, status: 1 })
      })
    );
    expect(commit).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('looks up the shared WFO location and the user-owned WFH location', async () => {
    const { checkOut, locationFindOne } = await loadCheckOut();

    await checkOut(buildReq(), buildRes(), jest.fn());

    expect(locationFindOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ id_attendance_categories: 1, user_id: null })
      })
    );
    expect(locationFindOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ id_attendance_categories: 2, user_id: 1 })
      })
    );
  });
});

describe('checkOut failure handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rolls back and forwards the error when the update fails before commit', async () => {
    const attendance = buildAttendance({
      update: jest.fn().mockRejectedValue(new Error('db exploded'))
    });

    const { checkOut, commit, rollback } = await loadCheckOut({
      attendanceRecords: [attendance]
    });
    const res = buildRes();
    const next = jest.fn();

    await checkOut(buildReq(), res, next);

    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'db exploded' }));
    expect(res.status).not.toHaveBeenCalled();
  });

  /**
   * DEFECT, characterized not fixed.
   *
   * attendance.controller.js commits at line 1519, but lines 1522-1548 stay
   * inside the same try block. If anything throws after the commit -- here the
   * post-commit refetch returning null -- the catch at line 1550 calls
   * transaction.rollback() on an already-committed transaction. Sequelize
   * throws, so next(error) is never reached: the request produces an unhandled
   * rejection instead of an error response.
   *
   * When this is fixed, this test SHOULD fail. Replace it then with an
   * assertion that next() receives the original error.
   */
  it('swallows post-commit failures instead of forwarding them (known defect)', async () => {
    const attendance = buildAttendance();

    const { checkOut, commit, rollback } = await loadCheckOut({
      attendanceRecords: [attendance],
      updatedAttendance: null
    });
    const res = buildRes();
    const next = jest.fn();

    await expect(checkOut(buildReq(), res, next)).rejects.toThrow(
      /Transaction cannot be rolled back/
    );

    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledTimes(1);
    // The original TypeError never reaches the error handler.
    expect(next).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
