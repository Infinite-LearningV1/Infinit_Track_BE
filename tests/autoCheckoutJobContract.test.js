import { jest } from '@jest/globals';

/**
 * Characterization coverage for the missed-checkout flagger
 * (INF-252, Phase 6 groundwork).
 *
 * autoCheckout.job.js is the largest of the three background jobs (563 lines),
 * runs every 30 minutes plus a daily smart pass, and **closes attendance
 * sessions automatically** -- a final-state mutation on a schedule.
 *
 * Its two siblings each have a dedicated idempotency test. This one had none:
 * autoCheckout.test.js imports only fuzzyAhpEngine and exercises the FAHP
 * scoring helper, never the job. No test imported the real module.
 *
 * Phase 6 moves jobs onto application services, so what the job does today
 * needs pinning before it moves.
 */

const SHIFT_END = '18:30:00';
const TOLERANCE_MIN = 20;

const openSession = (overrides = {}) => ({
  id_attendance: 11,
  user_id: 7,
  attendance_date: '2026-07-28',
  time_in: '2026-07-28T09:00:00+07:00',
  time_out: null,
  notes: null,
  user: { id_users: 7, full_name: 'Nadia Putri' },
  update: jest.fn().mockResolvedValue(undefined),
  ...overrides
});

const loadJob = async ({ batch = [], lastEvent = null } = {}) => {
  jest.resetModules();

  const attendanceUpdateCalls = [];
  const processBatchRecords = jest.fn(async (_model, queryOptions, processBatch) => {
    // Hand the caller's batch straight through so the test controls the set.
    const result = await processBatch(batch, 1);
    return { totalProcessed: batch.length, ...result };
  });

  const locationEventFindOne = jest.fn().mockResolvedValue(lastEvent);

  jest.unstable_mockModule('../src/utils/jobHelper.js', () => ({
    processBatchRecords,
    executeJobWithTimeout: jest.fn(async (_n, fn) => fn()),
    createTimer: jest.fn(() => ({ end: jest.fn() }))
  }));

  jest.unstable_mockModule('../src/models/index.js', () => ({
    Attendance: { findAll: jest.fn(), findOne: jest.fn(), update: jest.fn() },
    User: {},
    LocationEvent: { findOne: locationEventFindOne },
    AttendanceCategory: {},
    Booking: { findAll: jest.fn(), findOne: jest.fn() },
    Location: {},
    Settings: { findAll: jest.fn(), findOne: jest.fn() },
    Role: {},
    Photo: {},
    AttendanceStatus: {},
    BookingStatus: {}
  }));

  jest.unstable_mockModule('../src/utils/settings.js', () => ({
    getOperationalSettings: jest.fn(async () => ({
      defaultShiftEnd: SHIFT_END,
      lateCheckoutToleranceMin: TOLERANCE_MIN,
      autoCheckoutIdleMin: 12,
      autoCheckoutTBufferMin: 45
    }))
  }));

  jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
    calculateWorkHour: jest.fn(() => 8),
    formatWorkHour: jest.fn(() => '08:00:00'),
    formatTimeOnly: jest.fn(() => '09:00')
  }));

  jest.unstable_mockModule('../src/utils/geofence.js', () => ({
    toJakartaTime: jest.fn((d) => d),
    calculateDistance: jest.fn(() => 0),
    getJakartaTime: jest.fn(() => new Date()),
    getJakartaDateString: jest.fn(() => '2026-07-28'),
    getCurrentTimeForDB: jest.fn(() => new Date())
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
  }));

  jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
    default: {
      getSmartAcAhpWeights: () => ({
        history: 0.4,
        checkin_pattern: 0.3,
        context: 0.2,
        transition: 0.1,
        consistency_ratio: 0.05
      }),
      weightedPrediction: jest.fn(() => null)
    }
  }));

  const mod = await import('../src/jobs/autoCheckout.job.js');
  return { ...mod, processBatchRecords, locationEventFindOne, attendanceUpdateCalls };
};

/**
 * Freezes the clock at a Jakarta wall-clock time on 2026-07-28.
 *
 * The times used below are chosen to give the same outcome for any machine
 * offset between UTC and UTC+9. That is necessary because the job's own
 * Jakarta conversion is offset-dependent -- see the "timezone dependence"
 * block at the bottom of this file, and F41.
 */
const freezeJakarta = (hhmm) => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(`2026-07-28T${hhmm}:00+07:00`));
};

/** Comfortably past the deadline under any offset in that range. */
const WELL_AFTER_DEADLINE = '23:00';
/** Comfortably before it under any offset in that range. */
const WELL_BEFORE_DEADLINE = '08:00';

afterEach(() => {
  jest.useRealTimers();
});

describe('triggerAutoCheckout envelope', () => {
  it('reports success with a timestamp and the flagger details', async () => {
    freezeJakarta(WELL_AFTER_DEADLINE);
    const { triggerAutoCheckout } = await loadJob({ batch: [] });

    const result = await triggerAutoCheckout();

    expect(result).toMatchObject({
      success: true,
      message: 'Missed checkout flagger completed'
    });
    expect(typeof result.timestamp).toBe('string');
    expect(result.details).toMatchObject({ total_processed: 0, flagged: 0 });
  });

  it('selects only sessions that are still open', async () => {
    freezeJakarta(WELL_AFTER_DEADLINE);
    const { triggerAutoCheckout, processBatchRecords } = await loadJob({ batch: [] });

    await triggerAutoCheckout();

    const [, queryOptions] = processBatchRecords.mock.calls[0];
    expect(queryOptions.where).toMatchObject({ time_out: null });
  });
});

describe('the tolerance deadline', () => {
  it('does not close a session before shift end plus tolerance', async () => {
    freezeJakarta(WELL_BEFORE_DEADLINE);
    const session = openSession();
    const { triggerAutoCheckout } = await loadJob({ batch: [session] });

    const result = await triggerAutoCheckout();

    expect(session.update).not.toHaveBeenCalled();
    expect(result.details.flagged).toBe(0);
  });

  it('closes a session once the deadline has passed', async () => {
    freezeJakarta(WELL_AFTER_DEADLINE);
    const session = openSession();
    const { triggerAutoCheckout } = await loadJob({ batch: [session] });

    const result = await triggerAutoCheckout();

    expect(session.update).toHaveBeenCalledTimes(1);
    expect(result.details.flagged).toBe(1);
  });
});

describe('what the flagger writes', () => {
  it('sets time_out to shift end, not to the moment the job ran', async () => {
    freezeJakarta(WELL_AFTER_DEADLINE);
    const session = openSession();
    const { triggerAutoCheckout } = await loadJob({ batch: [session] });

    await triggerAutoCheckout();

    const written = session.update.mock.calls[0][0];
    const expected = new Date(`2026-07-28T${SHIFT_END}+07:00`);
    expect(written.time_out.toISOString()).toBe(expected.toISOString());
  });

  it('records a work_hour and an explanatory note', async () => {
    freezeJakarta(WELL_AFTER_DEADLINE);
    const session = openSession();
    const { triggerAutoCheckout } = await loadJob({ batch: [session] });

    await triggerAutoCheckout();

    const written = session.update.mock.calls[0][0];
    expect(written.work_hour).toBe(8);
    expect(written.notes).toContain('Auto checkout by system after tolerance');
  });

  it('appends to existing notes rather than replacing them', async () => {
    freezeJakarta(WELL_AFTER_DEADLINE);
    const session = openSession({ notes: 'Izin keluar sebentar' });
    const { triggerAutoCheckout } = await loadJob({ batch: [session] });

    await triggerAutoCheckout();

    const written = session.update.mock.calls[0][0];
    expect(written.notes.startsWith('Izin keluar sebentar')).toBe(true);
    expect(written.notes).toContain('Auto checkout by system');
  });

  it('enriches the note with the last known location event when one exists', async () => {
    freezeJakarta(WELL_AFTER_DEADLINE);
    const session = openSession();
    const { triggerAutoCheckout } = await loadJob({
      batch: [session],
      lastEvent: {
        event_timestamp: '2026-07-28T15:00:00+07:00',
        location_id: 5,
        event_type: 'EXIT'
      }
    });

    await triggerAutoCheckout();

    expect(session.update.mock.calls[0][0].notes).toContain('last_location_event=EXIT@5');
  });

  it('still closes the session when the location lookup fails', async () => {
    freezeJakarta(WELL_AFTER_DEADLINE);
    const session = openSession();
    const mod = await loadJob({ batch: [session] });
    mod.locationEventFindOne.mockRejectedValueOnce(new Error('lookup down'));

    const result = await mod.triggerAutoCheckout();

    expect(session.update).toHaveBeenCalledTimes(1);
    expect(result.details.flagged).toBe(1);
  });
});

describe('resilience and idempotency', () => {
  /**
   * The query filters on time_out: null, so a closed session is simply not
   * selected on the next run. Idempotency comes from the query rather than
   * from a guard inside the loop.
   */
  it('is idempotent because closed sessions are never selected', async () => {
    freezeJakarta(WELL_AFTER_DEADLINE);
    const { triggerAutoCheckout, processBatchRecords } = await loadJob({ batch: [] });

    await triggerAutoCheckout();

    const [, queryOptions] = processBatchRecords.mock.calls[0];
    expect(queryOptions.where.time_out).toBeNull();
  });

  it('keeps processing the batch when one record fails', async () => {
    freezeJakarta(WELL_AFTER_DEADLINE);
    const bad = openSession({
      id_attendance: 12,
      update: jest.fn().mockRejectedValue(new Error('row locked'))
    });
    const good = openSession({ id_attendance: 13 });
    const { triggerAutoCheckout } = await loadJob({ batch: [bad, good] });

    const result = await triggerAutoCheckout();

    expect(good.update).toHaveBeenCalledTimes(1);
    expect(result.details.flagged).toBe(1);
    expect(result.details.total_processed).toBe(2);
  });
});

describe('timezone dependence of the deadline (F41)', () => {
  /**
   * F41, characterized not fixed.
   *
   * The job derives "now in Jakarta" like this:
   *
   *   const s = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
   *   const jakartaTime = new Date(s);
   *
   * The first line produces a Jakarta wall-clock string. The second re-parses
   * that string as **machine-local** time. The result is displaced by
   * (machineOffset - JakartaOffset), so the deadline the flagger enforces
   * depends on the server's TZ rather than on Jakarta.
   *
   * In production this cancels out only because server.js sets
   * TZ=Asia/Jakarta. On a container with the usual UTC default the job would
   * believe it is 7 hours later than it is, and close everyone's attendance
   * around 11:30 Jakarta time.
   *
   * The assertions below are pure arithmetic -- no job import, no clock
   * mocking -- so they hold on any machine.
   */
  const reparseAsLocal = (instant) =>
    new Date(instant.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));

  const machineOffsetMinutes = -new Date('2026-07-28T12:00:00Z').getTimezoneOffset();
  const JAKARTA_OFFSET_MINUTES = 7 * 60;

  it('displaces the computed instant by exactly Jakarta offset minus machine offset', () => {
    // Parsing a Jakarta wall-clock string as machine-local yields
    //   wallclock - machineOffset
    // while the true epoch is
    //   wallclock - jakartaOffset
    // so the displacement is jakartaOffset - machineOffset.
    const instant = new Date('2026-07-28T12:00:00Z'); // 19:00 Jakarta
    const displacementMs = reparseAsLocal(instant).getTime() - instant.getTime();

    expect(displacementMs / 60000).toBe(JAKARTA_OFFSET_MINUTES - machineOffsetMinutes);
  });

  it('is only correct when the process runs in Asia/Jakarta', () => {
    const instant = new Date('2026-07-28T12:00:00Z');
    const isExact = reparseAsLocal(instant).getTime() === instant.getTime();

    expect(isExact).toBe(machineOffsetMinutes === JAKARTA_OFFSET_MINUTES);
  });

  it('would fire seven hours early on a UTC host', () => {
    // A UTC host has offset 0, so the displacement is +7h: the job believes
    // the clock is seven hours further along than it is, and the deadline
    // therefore passes seven hours early in real time.
    const displacementForUtcHost = JAKARTA_OFFSET_MINUTES - 0;

    expect(displacementForUtcHost).toBe(420);
  });
});
