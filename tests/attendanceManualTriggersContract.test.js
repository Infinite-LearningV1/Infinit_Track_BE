import { jest } from '@jest/globals';

/**
 * Characterization coverage for the five manual operational triggers
 * (INF-252 Phase 0b).
 *
 * These were the largest genuine gap left: routing and authorization were
 * pinned by attendanceRouteContract.test.js, but what each one does once
 * called was not -- and every one of them invokes a background job that
 * writes final attendance state.
 *
 * Two structural findings came out of writing these, both recorded rather
 * than fixed: the controllers duplicate an authorization check the route
 * already performs (F28), and the target_date validator checks shape only,
 * so calendrically impossible dates reach the jobs (F29).
 */

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const loadTriggers = async () => {
  jest.resetModules();

  const triggerAutoCheckout = jest.fn().mockResolvedValue(undefined);
  const runSmartAutoCheckoutForDate = jest.fn().mockResolvedValue({ processed: 3 });
  const triggerResolveWfaBookings = jest.fn().mockResolvedValue({ resolved: 2 });
  const resolveWfaBookingsForDate = jest.fn().mockResolvedValue({ resolved: 1 });
  const runGeneralAlphaForDate = jest.fn().mockResolvedValue({ created: 5 });

  jest.unstable_mockModule('../src/jobs/autoCheckout.job.js', () => ({
    triggerAutoCheckout,
    runSmartAutoCheckoutForDate
  }));

  jest.unstable_mockModule('../src/jobs/resolveWfaBookings.job.js', () => ({
    triggerResolveWfaBookings,
    resolveWfaBookingsForDate
  }));

  jest.unstable_mockModule('../src/jobs/createGeneralAlpha.job.js', () => ({
    runGeneralAlphaForDate
  }));

  jest.unstable_mockModule('../src/config/database.js', () => ({
    default: { transaction: jest.fn() }
  }));

  jest.unstable_mockModule('../src/models/index.js', () => ({
    Attendance: { findByPk: jest.fn(), findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() },
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

  return {
    ...mod,
    triggerAutoCheckout,
    runSmartAutoCheckoutForDate,
    triggerResolveWfaBookings,
    resolveWfaBookingsForDate,
    runGeneralAlphaForDate
  };
};

const admin = { id: 1, role_name: 'Admin' };
const req = (overrides = {}) => ({ body: {}, query: {}, params: {}, user: admin, ...overrides });

/** The three date-driven triggers share one validator and one shape. */
const DATE_TRIGGERS = [
  ['manualGeneralAlphaForDate', 'runGeneralAlphaForDate'],
  ['manualResolveWfaForDate', 'resolveWfaBookingsForDate'],
  ['manualSmartAutoCheckoutForDate', 'runSmartAutoCheckoutForDate']
];

describe('jobless triggers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('manualAutoCheckout runs the auto-checkout job and reports a timestamp', async () => {
    const { manualAutoCheckout, triggerAutoCheckout } = await loadTriggers();
    const res = buildRes();

    await manualAutoCheckout(req(), res, jest.fn());

    expect(triggerAutoCheckout).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(typeof body.timestamp).toBe('string');
  });

  it('manualResolveWfaBookings runs the resolver and returns its result verbatim', async () => {
    const { manualResolveWfaBookings, triggerResolveWfaBookings } = await loadTriggers();
    const res = buildRes();

    await manualResolveWfaBookings(req(), res, jest.fn());

    expect(triggerResolveWfaBookings).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Resolve unused WFA bookings job berhasil dijalankan secara manual.',
      data: { resolved: 2 }
    });
  });

  it('forwards a job failure to the error handler', async () => {
    const mod = await loadTriggers();
    const boom = new Error('job blew up');
    mod.triggerAutoCheckout.mockRejectedValueOnce(boom);
    const res = buildRes();
    const next = jest.fn();

    await mod.manualAutoCheckout(req(), res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('date-driven triggers', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(DATE_TRIGGERS)('%s requires target_date', async (fnName, jobName) => {
    const mod = await loadTriggers();
    const res = buildRes();

    await mod[fnName](req(), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'target_date harus YYYY-MM-DD'
    });
    expect(mod[jobName]).not.toHaveBeenCalled();
  });

  it.each(DATE_TRIGGERS)('%s rejects a malformed target_date', async (fnName, jobName) => {
    const mod = await loadTriggers();
    const res = buildRes();

    await mod[fnName](req({ body: { target_date: '28-07-2026' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mod[jobName]).not.toHaveBeenCalled();
  });

  it.each(DATE_TRIGGERS)('%s passes a valid target_date to its job', async (fnName, jobName) => {
    const mod = await loadTriggers();
    const res = buildRes();

    await mod[fnName](req({ body: { target_date: '2026-07-28' } }), res, jest.fn());

    expect(mod[jobName]).toHaveBeenCalledWith('2026-07-28');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it.each(DATE_TRIGGERS)('%s trims surrounding whitespace', async (fnName, jobName) => {
    const mod = await loadTriggers();

    await mod[fnName](req({ body: { target_date: '  2026-07-28  ' } }), buildRes(), jest.fn());

    expect(mod[jobName]).toHaveBeenCalledWith('2026-07-28');
  });

  /**
   * The date may arrive in the body, the query string, or the path params.
   * Clients rely on this; an extracted validator that only reads the body
   * would silently break the query-string callers.
   */
  it.each(DATE_TRIGGERS)('%s accepts target_date from the query string', async (fnName, jobName) => {
    const mod = await loadTriggers();

    await mod[fnName](req({ query: { target_date: '2026-07-28' } }), buildRes(), jest.fn());

    expect(mod[jobName]).toHaveBeenCalledWith('2026-07-28');
  });

  it.each(DATE_TRIGGERS)('%s accepts target_date from the path params', async (fnName, jobName) => {
    const mod = await loadTriggers();

    await mod[fnName](req({ params: { target_date: '2026-07-28' } }), buildRes(), jest.fn());

    expect(mod[jobName]).toHaveBeenCalledWith('2026-07-28');
  });

  /**
   * F29, characterized not fixed.
   *
   * The validator is /^\d{4}-\d{2}-\d{2}$/ -- a shape check, not a calendar
   * check. A date that cannot exist passes straight through to a job that
   * writes attendance state.
   */
  it.each(DATE_TRIGGERS)('%s accepts an impossible calendar date', async (fnName, jobName) => {
    const mod = await loadTriggers();
    const res = buildRes();

    await mod[fnName](req({ body: { target_date: '2026-13-45' } }), res, jest.fn());

    expect(mod[jobName]).toHaveBeenCalledWith('2026-13-45');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('redundant in-controller authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * F28, characterized not fixed.
   *
   * All five routes already carry roleGuard(['Admin', 'Management']), proven
   * by attendanceRouteContract.test.js. Each controller then repeats the same
   * check, so this 403 branch is unreachable through the mounted route.
   *
   * It is the mirror image of F10: /api/discipline enforces authorization in
   * the controller with NO roleGuard, while these five have both. Neither
   * places it consistently. The migrated module should keep it on the route.
   */
  it.each([
    ['manualAutoCheckout'],
    ['manualResolveWfaBookings'],
    ['manualGeneralAlphaForDate'],
    ['manualResolveWfaForDate'],
    ['manualSmartAutoCheckoutForDate']
  ])('%s still refuses a plain User when called directly', async (fnName) => {
    const mod = await loadTriggers();
    const res = buildRes();

    await mod[fnName](req({ user: { id: 9, role_name: 'User' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('never reaches its job when the redundant check fires', async () => {
    const mod = await loadTriggers();

    await mod.manualGeneralAlphaForDate(
      req({ user: { id: 9, role_name: 'User' }, body: { target_date: '2026-07-28' } }),
      buildRes(),
      jest.fn()
    );

    expect(mod.runGeneralAlphaForDate).not.toHaveBeenCalled();
  });
});
