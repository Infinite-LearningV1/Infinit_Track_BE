import { jest } from '@jest/globals';

/**
 * Characterization coverage for the today-locations snapshot builder
 * (INF-252, Phase 0 follow-up).
 *
 * This produces the dashboard map payload governed by ADR-008 — the one that
 * marks itself `authority: context_only` so it cannot be mistaken for the
 * final attendance record.
 *
 * It appeared in **no** test: zero real imports and zero mocks. The endpoint
 * above it has route and contract tests, but the builder that shapes the
 * payload had none.
 */

const attendanceRow = (overrides = {}) => ({
  id_attendance: 1,
  time_in: '2026-07-28T09:00:00+07:00',
  user: {
    id_users: 7,
    full_name: 'Nadia Putri',
    photo_file: { photo_url: 'https://cdn.example/nadia.jpg' }
  },
  location: { latitude: '-0.8917', longitude: '119.8707' },
  attendance_category: { category_name: 'WFO' },
  ...overrides
});

const load = async ({ rows = [], total = null, envMax } = {}) => {
  jest.resetModules();

  const count = jest.fn().mockResolvedValue(total ?? rows.length);
  const findAll = jest.fn().mockResolvedValue(rows);

  jest.unstable_mockModule('../src/models/index.js', () => ({
    Attendance: { count, findAll },
    AttendanceCategory: {},
    Location: {},
    Photo: {},
    User: {},
    Booking: {},
    Role: {},
    Settings: {},
    AttendanceStatus: {},
    BookingStatus: {},
    LocationEvent: {}
  }));

  jest.unstable_mockModule('../src/utils/geofence.js', () => ({
    getJakartaDateString: jest.fn(() => '2026-07-28'),
    calculateDistance: jest.fn(),
    getJakartaTime: jest.fn(),
    toJakartaTime: jest.fn(),
    getCurrentTimeForDB: jest.fn(),
    formatUTCToJakartaTime: jest.fn(() => '09:00')
  }));

  jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
    formatTimeOnly: jest.fn(() => '09:00'),
    calculateWorkHour: jest.fn(),
    formatWorkHour: jest.fn(),
    parseWorkHour: jest.fn()
  }));

  const previousEnv = process.env.HERO_MAP_MAX_USERS;
  if (envMax === undefined) delete process.env.HERO_MAP_MAX_USERS;
  else process.env.HERO_MAP_MAX_USERS = envMax;

  const { buildTodayLocationsSnapshot } = await import('../src/utils/todayLocationsSnapshot.js');

  const restoreEnv = () => {
    if (previousEnv === undefined) delete process.env.HERO_MAP_MAX_USERS;
    else process.env.HERO_MAP_MAX_USERS = previousEnv;
  };

  return { buildTodayLocationsSnapshot, count, findAll, restoreEnv };
};

describe('limit validation', () => {
  it.each([
    ['a non-numeric string', 'abc'],
    ['zero', '0'],
    ['a negative value', '-5'],
    ['a decimal', '1.5']
  ])('rejects %s with a 400', async (_name, limit) => {
    const { buildTodayLocationsSnapshot, restoreEnv } = await load();

    await expect(buildTodayLocationsSnapshot({ limit })).rejects.toMatchObject({
      status: 400,
      message: 'limit must be a positive integer'
    });

    restoreEnv();
  });

  /**
   * `parseLimit` requires `typeof limit === 'string'`, so a caller that has
   * already parsed the query parameter into a number gets a 400. The route
   * passes `req.query.limit` straight through, so this holds today — but it
   * is a brittle contract for any future caller.
   */
  it('rejects a numeric limit because it demands a string', async () => {
    const { buildTodayLocationsSnapshot, restoreEnv } = await load();

    await expect(buildTodayLocationsSnapshot({ limit: 10 })).rejects.toMatchObject({
      status: 400
    });

    restoreEnv();
  });

  it('accepts an absent limit', async () => {
    const { buildTodayLocationsSnapshot, restoreEnv } = await load();

    await expect(buildTodayLocationsSnapshot({})).resolves.toBeDefined();

    restoreEnv();
  });
});

describe('the effective user cap', () => {
  it('defaults to 500 when no limit and no env override are given', async () => {
    const { buildTodayLocationsSnapshot, findAll, restoreEnv } = await load();

    await buildTodayLocationsSnapshot({});

    expect(findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
    restoreEnv();
  });

  it('honours HERO_MAP_MAX_USERS', async () => {
    const { buildTodayLocationsSnapshot, findAll, restoreEnv } = await load({ envMax: '25' });

    await buildTodayLocationsSnapshot({});

    expect(findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));
    restoreEnv();
  });

  it('falls back to 500 when the env value is not a positive integer', async () => {
    const { buildTodayLocationsSnapshot, findAll, restoreEnv } = await load({ envMax: 'lots' });

    await buildTodayLocationsSnapshot({});

    expect(findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
    restoreEnv();
  });

  it('takes the smaller of the request limit and the env cap', async () => {
    const { buildTodayLocationsSnapshot, findAll, restoreEnv } = await load({ envMax: '50' });

    await buildTodayLocationsSnapshot({ limit: '200' });

    expect(findAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    restoreEnv();
  });
});

describe('the query it builds', () => {
  it('defaults the date to today in Jakarta', async () => {
    const { buildTodayLocationsSnapshot, findAll, restoreEnv } = await load();

    const snapshot = await buildTodayLocationsSnapshot({});

    expect(snapshot.date).toBe('2026-07-28');
    expect(findAll.mock.calls[0][0].where).toMatchObject({ attendance_date: '2026-07-28' });
    restoreEnv();
  });

  it('accepts an explicit date', async () => {
    const { buildTodayLocationsSnapshot, findAll, restoreEnv } = await load();

    const snapshot = await buildTodayLocationsSnapshot({ date: '2026-07-01' });

    expect(snapshot.date).toBe('2026-07-01');
    expect(findAll.mock.calls[0][0].where).toMatchObject({ attendance_date: '2026-07-01' });
    restoreEnv();
  });

  it('requires both the location and category joins', async () => {
    const { buildTodayLocationsSnapshot, findAll, restoreEnv } = await load();

    await buildTodayLocationsSnapshot({});

    const includes = findAll.mock.calls[0][0].include;
    const required = includes.filter((i) => i.required === true);
    expect(required).toHaveLength(2);
    restoreEnv();
  });

  it('orders by check-in time ascending', async () => {
    const { buildTodayLocationsSnapshot, findAll, restoreEnv } = await load();

    await buildTodayLocationsSnapshot({});

    expect(findAll.mock.calls[0][0].order).toEqual([['time_in', 'ASC']]);
    restoreEnv();
  });
});

describe('the ADR-008 envelope', () => {
  it('marks the payload as context, not authority', async () => {
    const { buildTodayLocationsSnapshot, restoreEnv } = await load();

    const snapshot = await buildTodayLocationsSnapshot({});

    expect(snapshot).toMatchObject({
      timezone: 'Asia/Jakarta',
      snapshot_type: 'attendance_checkin_snapshot',
      is_live_tracking: false,
      authority: 'context_only',
      final_attendance_authority: 'attendance_records'
    });
    restoreEnv();
  });
});

describe('row mapping', () => {
  it('parses coordinates into numbers', async () => {
    const { buildTodayLocationsSnapshot, restoreEnv } = await load({ rows: [attendanceRow()] });

    const { locations } = await buildTodayLocationsSnapshot({});

    expect(locations[0].latitude).toBe(-0.8917);
    expect(typeof locations[0].longitude).toBe('number');
    restoreEnv();
  });

  it.each([
    ['WFO', 'WFO'],
    ['Work From Office', 'WFO'],
    ['Work From Home', 'WFH'],
    ['Work From Anywhere', 'WFA']
  ])('maps category "%s" to status %s', async (categoryName, status) => {
    const rows = [attendanceRow({ attendance_category: { category_name: categoryName } })];
    const { buildTodayLocationsSnapshot, restoreEnv } = await load({ rows });

    const { locations } = await buildTodayLocationsSnapshot({});

    expect(locations[0].status).toBe(status);
    restoreEnv();
  });

  it('falls back to Unknown User and a null photo', async () => {
    const rows = [attendanceRow({ user: { id_users: 9, full_name: null, photo_file: null } })];
    const { buildTodayLocationsSnapshot, restoreEnv } = await load({ rows });

    const { locations } = await buildTodayLocationsSnapshot({});

    expect(locations[0]).toMatchObject({ full_name: 'Unknown User', photo: null });
    restoreEnv();
  });

  it.each([
    ['unparseable coordinates', { location: { latitude: 'north', longitude: 'east' } }],
    ['an unknown category', { attendance_category: { category_name: 'WFX' } }]
  ])('drops a row with %s', async (_name, overrides) => {
    const rows = [attendanceRow(overrides)];
    const { buildTodayLocationsSnapshot, restoreEnv } = await load({ rows });

    const { locations } = await buildTodayLocationsSnapshot({});

    expect(locations).toHaveLength(0);
    restoreEnv();
  });
});

describe('truncation reporting', () => {
  it('is not truncated when everything fits', async () => {
    const { buildTodayLocationsSnapshot, restoreEnv } = await load({
      rows: [attendanceRow()],
      total: 1
    });

    const snapshot = await buildTodayLocationsSnapshot({});

    expect(snapshot).toMatchObject({ total_users: 1, truncated: false, truncated_at: null });
    restoreEnv();
  });

  it('reports the cap when more rows exist than the limit allows', async () => {
    const { buildTodayLocationsSnapshot, restoreEnv } = await load({
      rows: [attendanceRow()],
      total: 900
    });

    const snapshot = await buildTodayLocationsSnapshot({ limit: '10' });

    expect(snapshot).toMatchObject({ total_users: 900, truncated: true, truncated_at: 10 });
    restoreEnv();
  });

  /**
   * F46, characterized not fixed.
   *
   * `truncated` compares total_users against the cap. It says nothing about
   * rows dropped during mapping for unusable coordinates or an unknown
   * category. A client can therefore receive fewer locations than total_users
   * with truncated: false, and no field explains the difference.
   */
  it('reports truncated: false even when rows were silently dropped', async () => {
    const rows = [
      attendanceRow(),
      attendanceRow({ id_attendance: 2, attendance_category: { category_name: 'WFX' } })
    ];
    const { buildTodayLocationsSnapshot, restoreEnv } = await load({ rows, total: 2 });

    const snapshot = await buildTodayLocationsSnapshot({});

    expect(snapshot.total_users).toBe(2);
    expect(snapshot.locations).toHaveLength(1);
    expect(snapshot.truncated).toBe(false);
    restoreEnv();
  });
});
