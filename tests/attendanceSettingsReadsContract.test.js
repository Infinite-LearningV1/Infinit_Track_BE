import { jest } from '@jest/globals';

/**
 * Characterization coverage for the two auto-checkout diagnostic reads
 * (INF-252 Phase 0b, final slice).
 *
 * These are the last two uncovered endpoints. They are low-risk on their own,
 * but writing them surfaced two things worth pinning: the pair duplicates
 * roughly thirty lines verbatim (F32), and the enhanced variant issues one
 * extra query per active attendance (F33) -- a concrete N+1 of exactly the
 * kind Phase 8 is meant to audit.
 */

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const activeRow = (id, userId) => ({
  id_attendance: id,
  user_id: userId,
  attendance_date: '2026-07-28',
  time_in: '2026-07-28 09:00:00',
  user: { id_users: userId, full_name: `User ${userId}`, nip_nim: `A${userId}` }
});

const loadSettingsReads = async ({ autoTimeSetting = { setting_value: '18:30:00' }, active = [] } = {}) => {
  jest.resetModules();

  const settingsFindOne = jest.fn().mockResolvedValue(autoTimeSetting);
  // First call returns the active list; later calls are the per-user history
  // lookups the enhanced endpoint makes inside its loop.
  const attendanceFindAll = jest.fn().mockResolvedValueOnce(active).mockResolvedValue([]);
  const getOperationalSettings = jest.fn().mockResolvedValue({
    autoCheckoutIdleMin: 12,
    autoCheckoutTBufferMin: 45,
    defaultShiftEnd: '18:30:00'
  });

  jest.unstable_mockModule('../src/config/database.js', () => ({
    default: { transaction: jest.fn() }
  }));

  jest.unstable_mockModule('../src/models/index.js', () => ({
    Attendance: {
      findAll: attendanceFindAll,
      findOne: jest.fn(),
      findByPk: jest.fn(),
      findAndCountAll: jest.fn(),
      create: jest.fn()
    },
    Settings: { findOne: settingsFindOne, findAll: jest.fn().mockResolvedValue([]) },
    User: {},
    Booking: { findOne: jest.fn() },
    Location: { findOne: jest.fn() },
    LocationEvent: { create: jest.fn() },
    AttendanceCategory: {},
    AttendanceStatus: {},
    BookingStatus: {},
    Role: {},
    Photo: {}
  }));

  jest.unstable_mockModule('../src/utils/settings.js', () => ({ getOperationalSettings }));

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
    default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
  }));

  jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
    default: { calculateSmartCheckoutScore: jest.fn(() => ({ score: 50, label: 'MEDIUM' })) }
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

  const mod = await import('../src/controllers/attendance.controller.js');
  return { ...mod, settingsFindOne, attendanceFindAll, getOperationalSettings };
};

const req = () => ({ query: {}, body: {}, params: {}, user: { id: 1, role_name: 'Admin' } });

describe('getAutoCheckoutSettings', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads the configured auto-checkout time', async () => {
    const { getAutoCheckoutSettings, settingsFindOne } = await loadSettingsReads();
    const res = buildRes();

    await getAutoCheckoutSettings(req(), res, jest.fn());

    expect(settingsFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { setting_key: 'checkout.auto_time' } })
    );
    expect(res.json.mock.calls[0][0].data.auto_checkout_time).toBe('18:30:00');
  });

  it('reports "Not configured" when the setting is absent', async () => {
    const { getAutoCheckoutSettings } = await loadSettingsReads({ autoTimeSetting: null });
    const res = buildRes();

    await getAutoCheckoutSettings(req(), res, jest.fn());

    expect(res.json.mock.calls[0][0].data.auto_checkout_time).toBe('Not configured');
  });

  it('selects only sessions that are still open today', async () => {
    const { getAutoCheckoutSettings, attendanceFindAll } = await loadSettingsReads();

    await getAutoCheckoutSettings(req(), buildRes(), jest.fn());

    expect(attendanceFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ time_out: null })
      })
    );
  });

  it('maps each open session to the documented shape', async () => {
    const { getAutoCheckoutSettings } = await loadSettingsReads({
      active: [activeRow(1, 7), activeRow(2, 8)]
    });
    const res = buildRes();

    await getAutoCheckoutSettings(req(), res, jest.fn());

    const { data } = res.json.mock.calls[0][0];
    expect(data.active_attendances_count).toBe(2);
    expect(data.active_attendances[0]).toEqual({
      id_attendance: 1,
      user_id: 7,
      user_name: 'User 7',
      time_in: '09:00',
      attendance_date: '2026-07-28'
    });
  });

  it('forwards a query failure to the error handler', async () => {
    const boom = new Error('db down');
    const mod = await loadSettingsReads();
    mod.settingsFindOne.mockRejectedValueOnce(boom);
    const res = buildRes();
    const next = jest.fn();

    await mod.getAutoCheckoutSettings(req(), res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('getEnhancedAutoCheckoutSettings', () => {
  beforeEach(() => jest.clearAllMocks());

  it('additionally loads the operational settings', async () => {
    const { getEnhancedAutoCheckoutSettings, getOperationalSettings } = await loadSettingsReads();

    await getEnhancedAutoCheckoutSettings(req(), buildRes(), jest.fn());

    expect(getOperationalSettings).toHaveBeenCalledTimes(1);
  });

  it('reads the same setting key as its simpler sibling', async () => {
    const { getEnhancedAutoCheckoutSettings, settingsFindOne } = await loadSettingsReads();

    await getEnhancedAutoCheckoutSettings(req(), buildRes(), jest.fn());

    expect(settingsFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { setting_key: 'checkout.auto_time' } })
    );
  });

  /**
   * F33, characterized not fixed.
   *
   * The endpoint fetches the open sessions in one query, then loops over them
   * and issues a further Attendance.findAll per session to load that user's
   * month of history. N open sessions cost N+1 queries.
   *
   * This is the concrete instance of what INF-252 Phase 8 calls "audit N+1
   * and indexes based on actual queries".
   */
  it('issues one extra query per open session', async () => {
    const { getEnhancedAutoCheckoutSettings, attendanceFindAll } = await loadSettingsReads({
      active: [activeRow(1, 7), activeRow(2, 8), activeRow(3, 9)]
    });

    await getEnhancedAutoCheckoutSettings(req(), buildRes(), jest.fn());

    // 1 query for the open sessions, then 1 per session.
    expect(attendanceFindAll).toHaveBeenCalledTimes(4);
  });

  it('makes no per-session query when nothing is open', async () => {
    const { getEnhancedAutoCheckoutSettings, attendanceFindAll } = await loadSettingsReads({
      active: []
    });

    await getEnhancedAutoCheckoutSettings(req(), buildRes(), jest.fn());

    expect(attendanceFindAll).toHaveBeenCalledTimes(1);
  });

  it('answers 200 with a success envelope', async () => {
    const { getEnhancedAutoCheckoutSettings } = await loadSettingsReads({
      active: [activeRow(1, 7)]
    });
    const res = buildRes();
    const next = jest.fn();

    await getEnhancedAutoCheckoutSettings(req(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });
});
