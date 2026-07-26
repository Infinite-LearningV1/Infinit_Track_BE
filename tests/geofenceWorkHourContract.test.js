import {
  calculateDistance,
  isWithinRadius,
  getJakartaTime,
  getJakartaDateString,
  toJakartaTime,
  formatUTCToJakartaTime
} from '../src/utils/geofence.js';
import {
  formatWorkHour,
  parseWorkHour,
  calculateWorkHour
} from '../src/utils/workHourFormatter.js';

/**
 * Characterization coverage for the two computational cores of attendance
 * (INF-252, Phase 0 follow-up).
 *
 * `geofence.js` decides whether a check-in is allowed at all.
 * `workHourFormatter.js` decides the hours that get recorded.
 *
 * Both are mocked by **seventeen** test files each and were imported for real
 * by none. Every attendance test in the suite asserts behavior downstream of
 * these functions while replacing them with stubs, so nothing verified the
 * arithmetic they all depend on.
 *
 * They also hold the Jakarta helpers whose absence caused F17 and F41 --
 * making it worth asking whether the helpers themselves are correct. One is
 * not: see F42.
 */

/** Host offset in minutes, east-positive. */
const HOST_OFFSET_MIN = -new Date('2026-07-28T12:00:00Z').getTimezoneOffset();
const JAKARTA_OFFSET_MIN = 7 * 60;

/** Jakarta wall-clock parts for an instant, via Intl — correct on any host. */
const jakartaParts = (instant) => {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  return parts;
};

describe('calculateDistance', () => {
  const OFFICE = [-0.8917, 119.8707]; // Palu

  it('returns zero for identical coordinates', () => {
    expect(calculateDistance(...OFFICE, ...OFFICE)).toBe(0);
  });

  it('matches the known length of one degree of latitude', () => {
    const metres = calculateDistance(0, 0, 1, 0);
    // Mean-radius Haversine gives ~111.195 km per degree of latitude.
    expect(metres).toBeGreaterThan(111_100);
    expect(metres).toBeLessThan(111_300);
  });

  it('is symmetric', () => {
    const there = calculateDistance(-0.89, 119.87, -0.90, 119.88);
    const back = calculateDistance(-0.90, 119.88, -0.89, 119.87);
    expect(there).toBeCloseTo(back, 9);
  });

  it('resolves distances at geofence scale', () => {
    // ~0.0009 degrees of latitude is roughly 100 m.
    const metres = calculateDistance(-0.8917, 119.8707, -0.8908, 119.8707);
    expect(metres).toBeGreaterThan(90);
    expect(metres).toBeLessThan(110);
  });

  it('handles antipodal-ish separation without NaN', () => {
    expect(Number.isFinite(calculateDistance(-89, -179, 89, 179))).toBe(true);
  });
});

describe('isWithinRadius', () => {
  it('accepts a point inside the radius', () => {
    expect(isWithinRadius(-0.8917, 119.8707, -0.8917, 119.8707, 100)).toBe(true);
  });

  it('rejects a point outside the radius', () => {
    expect(isWithinRadius(0, 0, 1, 0, 100)).toBe(false);
  });

  /**
   * The comparison is `distance <= radius`, so a point exactly on the
   * boundary is inside. Worth pinning: a strict `<` would silently exclude
   * anyone standing on the perimeter.
   */
  it('treats the boundary itself as inside', () => {
    const exact = calculateDistance(0, 0, 1, 0);
    expect(isWithinRadius(0, 0, 1, 0, exact)).toBe(true);
  });
});

describe('Jakarta time helpers', () => {
  it('getJakartaTime exposes Jakarta wall-clock values through local getters', () => {
    const parts = jakartaParts(new Date());
    const jakarta = getJakartaTime();

    expect(jakarta.getFullYear()).toBe(Number(parts.year));
    expect(jakarta.getMonth() + 1).toBe(Number(parts.month));
    expect(jakarta.getDate()).toBe(Number(parts.day));
    expect(jakarta.getHours()).toBe(Number(parts.hour));
  });

  it('getJakartaDateString agrees with getJakartaTime', () => {
    const parts = jakartaParts(new Date());
    expect(getJakartaDateString()).toBe(`${parts.year}-${parts.month}-${parts.day}`);
  });

  it('toJakartaTime returns null for a missing date', () => {
    expect(toJakartaTime(null)).toBeNull();
    expect(toJakartaTime(undefined)).toBeNull();
  });

  it('toJakartaTime shifts the epoch forward by exactly seven hours', () => {
    const instant = new Date('2026-07-28T03:00:00Z');
    expect(toJakartaTime(instant).getTime() - instant.getTime()).toBe(7 * 60 * 60 * 1000);
  });

  /**
   * F42, characterized not fixed.
   *
   * The two helpers in this file disagree about what a "Jakarta time" is.
   *
   *   getJakartaTime()  -> local GETTERS are Jakarta; the epoch is wrong
   *   toJakartaTime(d)  -> the UTC reading is Jakarta; local getters are wrong
   *
   * A caller must know which one it holds. `minutesSinceMidnightWIB` in
   * autoCheckout.job.js calls `toJakartaTime(d).getHours()`, mixing the two
   * contracts -- correct only when the host runs in UTC, and therefore wrong
   * in production, which sets TZ=Asia/Jakarta.
   */
  it('toJakartaTime local getters are Jakarta only when the host runs in UTC', () => {
    const instant = new Date('2026-07-28T03:00:00Z'); // 10:00 Jakarta
    const readAsLocalHour = toJakartaTime(instant).getHours();

    const expectedIfHostIsUtc = 10;
    expect(readAsLocalHour === expectedIfHostIsUtc).toBe(HOST_OFFSET_MIN === 0);
  });

  it('toJakartaTime read as UTC is always the Jakarta wall clock', () => {
    const instant = new Date('2026-07-28T03:00:00Z');
    expect(toJakartaTime(instant).toISOString().substring(11, 16)).toBe('10:00');
  });

  it('the two helpers disagree by exactly the host offset', () => {
    // getJakartaTime is meant to be read with local getters; toJakartaTime
    // with UTC getters. Reading both locally shows how far apart they are --
    // and the gap is the host offset, which is why mixing them produces the
    // F17 / F41 / F42 family.
    const instant = new Date();
    const viaLocalGetters = toJakartaTime(instant).getHours();
    const trueJakartaHour = Number(jakartaParts(instant).hour);

    const gapHours = (viaLocalGetters - trueJakartaHour + 24) % 24;
    expect(gapHours).toBe(((HOST_OFFSET_MIN - JAKARTA_OFFSET_MIN) / 60 + 24 + 7) % 24);
  });
});

describe('formatUTCToJakartaTime', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an unparseable string', 'not-a-date']
  ])('returns 00:00 for %s', (_name, input) => {
    expect(formatUTCToJakartaTime(input)).toBe('00:00');
  });

  it('pads hours and minutes to two digits', () => {
    const d = new Date(2026, 6, 28, 9, 5, 0); // local 09:05
    expect(formatUTCToJakartaTime(d)).toBe('09:05');
  });

  it('reads the local clock rather than converting, despite its name', () => {
    // The function assumes Sequelize already returned WIB values, so it does
    // no conversion at all -- it formats whatever the local getters say.
    const d = new Date(2026, 6, 28, 17, 42, 0);
    expect(formatUTCToJakartaTime(d)).toBe('17:42');
  });
});

describe('formatWorkHour', () => {
  it.each([
    ['zero', 0],
    ['null', null],
    ['undefined', undefined],
    ['a negative value', -3]
  ])('returns 00:00 for %s', (_name, input) => {
    expect(formatWorkHour(input)).toBe('00:00');
  });

  it('splits a fractional hour into minutes', () => {
    expect(formatWorkHour(8.5)).toBe('08:30');
    expect(formatWorkHour(1.25)).toBe('01:15');
  });

  it('pads a single-digit hour', () => {
    expect(formatWorkHour(9)).toBe('09:00');
  });

  it('carries into the next hour when rounding reaches sixty minutes', () => {
    // 7.999 -> 59.94 minutes -> rounds to 60 -> must become 08:00, not 07:60.
    expect(formatWorkHour(7.999)).toBe('08:00');
  });
});

describe('parseWorkHour', () => {
  it('is the inverse of formatWorkHour for whole minutes', () => {
    expect(parseWorkHour('08:30')).toBe(8.5);
  });

  it.each([
    ['null', null],
    ['a non-string', 830],
    ['a malformed string', 'eight thirty']
  ])('returns 0 for %s', (_name, input) => {
    expect(parseWorkHour(input)).toBe(0);
  });
});

describe('calculateWorkHour', () => {
  const at = (hhmm) => new Date(`2026-07-28T${hhmm}:00+07:00`);

  it.each([
    ['no time_in', null, at('17:00')],
    ['no time_out', at('09:00'), null]
  ])('returns 0 with %s', (_name, tIn, tOut) => {
    expect(calculateWorkHour(tIn, tOut)).toBe(0);
  });

  it('never returns a negative duration', () => {
    expect(calculateWorkHour(at('17:00'), at('09:00'))).toBe(0);
  });

  it('computes a normal working day', () => {
    expect(calculateWorkHour(at('09:00'), at('17:30'))).toBe(8.5);
  });

  it('rounds long durations to two decimals', () => {
    const tIn = new Date('2026-07-28T09:00:00Z');
    const tOut = new Date('2026-07-28T17:20:00Z'); // 8h20m = 8.3333
    expect(calculateWorkHour(tIn, tOut)).toBe(8.33);
  });

  /**
   * Sub-hour durations use minute precision, and anything under a full
   * minute is discarded rather than rounded up.
   */
  it('discards a session shorter than one minute', () => {
    const tIn = new Date('2026-07-28T09:00:00Z');
    expect(calculateWorkHour(tIn, new Date('2026-07-28T09:00:30Z'))).toBe(0);
  });

  it('keeps minute precision below one hour', () => {
    const tIn = new Date('2026-07-28T09:00:00Z');
    expect(calculateWorkHour(tIn, new Date('2026-07-28T09:30:00Z'))).toBe(0.5);
  });
});
