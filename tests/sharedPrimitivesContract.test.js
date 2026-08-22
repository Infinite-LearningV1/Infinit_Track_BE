import { isSafeUrl, assertSafeUrl } from '../src/utils/url.js';
import { parseIsoDateUtcStrict } from '../src/utils/isoDate.js';

/**
 * Characterization coverage for the last two untested shared primitives
 * (INF-252, closing the coverage sweep).
 *
 * `url.js` guards every URL field that passes through `validator.js` — it is
 * the reason a `javascript:` or `file:` URL cannot be stored.
 *
 * `isoDate.js` is the strict calendar validator. It matters beyond its size:
 * the `manual-*` operational triggers hand-roll `/^\d{4}-\d{2}-\d{2}$/`
 * instead of using it, which is why an impossible date reaches a job that
 * writes attendance state (F29). The correct tool was already here.
 */

describe('isSafeUrl', () => {
  it.each([
    ['https', 'https://example.com/photo.jpg'],
    ['http', 'http://example.com'],
    ['a host with a port', 'https://example.com:8443/x']
  ])('accepts %s', (_name, value) => {
    expect(isSafeUrl(value)).toBe(true);
  });

  /**
   * The protocol allowlist is the point of this helper. Each of these parses
   * as a valid URL, so only the allowlist keeps them out.
   */
  it.each([
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html;base64,PHNjcmlwdD4='],
    ['file', 'file:///etc/passwd'],
    ['ftp', 'ftp://example.com/x']
  ])('rejects the %s scheme', (_name, value) => {
    expect(isSafeUrl(value)).toBe(false);
  });

  it.each([
    ['a non-string', 42],
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['an unparseable value', 'not a url'],
    ['a scheme-relative URL', '//example.com/x'],
    ['a bare path', '/photos/1.jpg']
  ])('rejects %s', (_name, value) => {
    expect(isSafeUrl(value)).toBe(false);
  });

  it('requires a hostname even when the scheme is allowed', () => {
    expect(isSafeUrl('http://')).toBe(false);
  });
});

describe('assertSafeUrl', () => {
  it('returns true for an acceptable URL', () => {
    expect(assertSafeUrl('https://example.com')).toBe(true);
  });

  it('throws the default message when none is supplied', () => {
    expect(() => assertSafeUrl('javascript:alert(1)')).toThrow(
      'URL tidak valid atau protokol tidak diizinkan'
    );
  });

  it('throws a caller-supplied message', () => {
    expect(() => assertSafeUrl('', 'Foto tidak valid')).toThrow('Foto tidak valid');
  });
});

describe('parseIsoDateUtcStrict', () => {
  it('parses a valid date at UTC midnight', () => {
    const date = parseIsoDateUtcStrict('2026-07-28');
    expect(date.toISOString()).toBe('2026-07-28T00:00:00.000Z');
  });

  it('accepts a real leap day', () => {
    expect(parseIsoDateUtcStrict('2024-02-29')).not.toBeNull();
  });

  /**
   * This is what the manual-* triggers are missing. Their regex accepts every
   * one of these; this parser does not (F29).
   */
  it.each([
    ['a non-leap 29 February', '2026-02-29'],
    ['a 31st in a 30-day month', '2026-04-31'],
    ['month 13', '2026-13-01'],
    ['day 45', '2026-07-45'],
    ['month zero', '2026-00-10'],
    ['day zero', '2026-07-00']
  ])('rejects %s', (_name, value) => {
    expect(parseIsoDateUtcStrict(value)).toBeNull();
  });

  it.each([
    ['a short year', '26-07-28'],
    ['unpadded parts', '2026-7-8'],
    ['slashes', '2026/07/28'],
    ['a trailing time', '2026-07-28T00:00:00Z'],
    ['surrounding whitespace', ' 2026-07-28 '],
    ['an empty string', '']
  ])('rejects %s on shape alone', (_name, value) => {
    expect(parseIsoDateUtcStrict(value)).toBeNull();
  });

  it('is timezone-independent because it builds the date in UTC', () => {
    // Date.UTC is used deliberately, so the result does not shift with the
    // host offset the way the hand-rolled conversions elsewhere do.
    const date = parseIsoDateUtcStrict('2026-01-01');
    expect(date.getUTCFullYear()).toBe(2026);
    expect(date.getUTCMonth()).toBe(0);
    expect(date.getUTCDate()).toBe(1);
  });
});
