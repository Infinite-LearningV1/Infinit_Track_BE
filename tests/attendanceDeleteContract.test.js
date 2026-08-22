import { jest } from '@jest/globals';

/**
 * Characterization coverage for deleteAttendance (INF-252 Phase 0b).
 *
 * This is the last untested attendance mutation, and the most destructive one
 * in the codebase: the Attendance model declares neither `paranoid` nor a
 * `deleted_at` column, so `destroy()` is an irreversible DELETE of a row the
 * backend treats as its authoritative final state.
 *
 * The tests below pin that behavior as it exists today, including three things
 * it does NOT do -- no transaction, no audit log, no guard on finalized
 * records. Those absences are recorded as F24 rather than fixed here.
 */

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const loadDeleteAttendance = async ({ record = null } = {}) => {
  jest.resetModules();

  const transaction = jest.fn();
  const loggerInfo = jest.fn();
  const loggerWarn = jest.fn();
  const findByPk = jest.fn().mockResolvedValue(record);

  jest.unstable_mockModule('../src/config/database.js', () => ({
    default: { transaction }
  }));

  jest.unstable_mockModule('../src/models/index.js', () => ({
    Attendance: { findByPk, findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() },
    Booking: { findOne: jest.fn() },
    Location: { findOne: jest.fn() },
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

  jest.unstable_mockModule('../src/utils/searchHelper.js', () => ({ applySearch: jest.fn() }));

  jest.unstable_mockModule('../src/jobs/autoCheckout.job.js', () => ({
    triggerAutoCheckout: jest.fn(),
    runSmartAutoCheckoutForDate: jest.fn()
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: { info: loggerInfo, warn: loggerWarn, error: jest.fn(), debug: jest.fn() }
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

  const { deleteAttendance } = await import('../src/controllers/attendance.controller.js');
  return { deleteAttendance, findByPk, transaction, loggerInfo, loggerWarn };
};

const req = (id = '10') => ({ params: { id }, user: { id: 1, role_name: 'Admin' } });

describe('deleteAttendance', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 when the record does not exist', async () => {
    const { deleteAttendance } = await loadDeleteAttendance({ record: null });
    const res = buildRes();

    await deleteAttendance(req('999'), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Data absensi tidak ditemukan.'
    });
  });

  it('destroys the record and confirms with 200', async () => {
    const record = { id_attendance: 10, destroy: jest.fn().mockResolvedValue(undefined) };
    const { deleteAttendance } = await loadDeleteAttendance({ record });
    const res = buildRes();
    const next = jest.fn();

    await deleteAttendance(req(), res, next);

    expect(record.destroy).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Data absensi berhasil dihapus.'
    });
  });

  it('looks the record up by primary key only, with no ownership or state filter', async () => {
    const record = { id_attendance: 10, destroy: jest.fn() };
    const { deleteAttendance, findByPk } = await loadDeleteAttendance({ record });

    await deleteAttendance(req('10'), buildRes(), jest.fn());

    expect(findByPk).toHaveBeenCalledWith('10');
  });

  it('forwards a destroy failure to the error handler', async () => {
    const boom = new Error('fk constraint');
    const record = { id_attendance: 10, destroy: jest.fn().mockRejectedValue(boom) };
    const { deleteAttendance } = await loadDeleteAttendance({ record });
    const res = buildRes();
    const next = jest.fn();

    await deleteAttendance(req(), res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
  });

  /**
   * F24, characterized not fixed.
   *
   * checkIn and checkOut both wrap their mutations in a transaction. This one
   * does not, so the delete is not part of any atomic unit.
   */
  it('opens no transaction, unlike every other attendance mutation', async () => {
    const record = { id_attendance: 10, destroy: jest.fn() };
    const { deleteAttendance, transaction } = await loadDeleteAttendance({ record });

    await deleteAttendance(req(), buildRes(), jest.fn());

    expect(transaction).not.toHaveBeenCalled();
  });

  /**
   * F24, characterized not fixed.
   *
   * deleteUser logs who deleted whom. This deletes an authoritative
   * attendance record and writes nothing at all, so an irreversible change to
   * final state leaves no application-level trace of who made it.
   */
  it('writes no audit log for an irreversible deletion', async () => {
    const record = { id_attendance: 10, destroy: jest.fn() };
    const { deleteAttendance, loggerInfo, loggerWarn } = await loadDeleteAttendance({ record });

    await deleteAttendance(req(), buildRes(), jest.fn());

    expect(loggerInfo).not.toHaveBeenCalled();
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  /**
   * F24, characterized not fixed.
   *
   * A completed record -- one that has been checked out and has work hours
   * booked -- is deleted just as readily as an open one. Nothing distinguishes
   * finalized attendance from in-progress attendance here.
   */
  it('deletes a completed record with no additional guard', async () => {
    const completed = {
      id_attendance: 10,
      time_in: '2026-07-28 09:00:00',
      time_out: '2026-07-28 17:00:00',
      work_hour: 8,
      destroy: jest.fn().mockResolvedValue(undefined)
    };
    const { deleteAttendance } = await loadDeleteAttendance({ record: completed });
    const res = buildRes();

    await deleteAttendance(req(), res, jest.fn());

    expect(completed.destroy).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
