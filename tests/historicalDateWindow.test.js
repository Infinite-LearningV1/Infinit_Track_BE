import { jest } from '@jest/globals';

const mockGetJakartaDateString = jest.fn(() => '2026-05-30');

jest.unstable_mockModule('../src/utils/geofence.js', () => ({
  getJakartaDateString: mockGetJakartaDateString
}));

const {
  HISTORICAL_WINDOW_PERIODS,
  buildEffectiveWindow,
  validateHistoricalDateWindowQuery
} = await import('../src/utils/historicalDateWindow.js');

const windowDates = (input) => {
  const window = buildEffectiveWindow(input);
  return {
    startDateStr: window.startDateStr,
    endDateStr: window.endDateStr
  };
};

describe('historical date window dashboard periods', () => {
  beforeEach(() => {
    mockGetJakartaDateString.mockReturnValue('2026-05-30');
  });

  test('documents accepted canonical and legacy period values', () => {
    expect(HISTORICAL_WINDOW_PERIODS).toEqual([
      'daily',
      'weekly',
      'monthly',
      'range',
      '30d',
      'current_month',
      'custom'
    ]);
    expect(HISTORICAL_WINDOW_PERIODS).not.toContain('all');
  });

  test('builds daily as today-only in Jakarta date', () => {
    expect(windowDates({ period: 'daily' })).toEqual({
      startDateStr: '2026-05-30',
      endDateStr: '2026-05-30'
    });
  });

  test('builds weekly as rolling 7 days including today', () => {
    expect(windowDates({ period: 'weekly' })).toEqual({
      startDateStr: '2026-05-24',
      endDateStr: '2026-05-30'
    });
  });

  test('builds monthly as rolling 30 days including today', () => {
    mockGetJakartaDateString.mockReturnValue('2026-05-15');

    expect(windowDates({ period: 'monthly' })).toEqual({
      startDateStr: '2026-04-16',
      endDateStr: '2026-05-15'
    });
  });

  test('keeps 30d as a deprecated alias for monthly', () => {
    mockGetJakartaDateString.mockReturnValue('2026-05-15');

    expect(windowDates({ period: '30d' })).toEqual({
      startDateStr: '2026-04-16',
      endDateStr: '2026-05-15'
    });
  });

  test('keeps current_month as a legacy calendar-month period', () => {
    mockGetJakartaDateString.mockReturnValue('2026-05-15');

    expect(windowDates({ period: 'current_month' })).toEqual({
      startDateStr: '2026-05-01',
      endDateStr: '2026-05-15'
    });
  });

  test('builds range from explicit from and to boundaries', () => {
    expect(
      windowDates({ period: 'range', from: '2026-05-03', to: '2026-05-09' })
    ).toEqual({
      startDateStr: '2026-05-03',
      endDateStr: '2026-05-09'
    });
  });

  test('keeps custom as a deprecated alias for range', () => {
    expect(
      windowDates({ period: 'custom', from: '2026-05-03', to: '2026-05-09' })
    ).toEqual({
      startDateStr: '2026-05-03',
      endDateStr: '2026-05-09'
    });
  });

  test('rejects all as unsupported', () => {
    expect(validateHistoricalDateWindowQuery({ period: 'all' })).toBe(
      'Parameter period harus berupa: daily, weekly, monthly, range, 30d, current_month, atau custom'
    );
  });

  test('requires from and to for range or custom', () => {
    expect(validateHistoricalDateWindowQuery({ period: 'range', from: '2026-05-01' })).toBe(
      'Parameter from dan to wajib diisi saat period=range atau custom'
    );
    expect(validateHistoricalDateWindowQuery({ period: 'custom', to: '2026-05-31' })).toBe(
      'Parameter from dan to wajib diisi saat period=range atau custom'
    );
  });

  test('keeps range maximum at 31 days', () => {
    expect(
      validateHistoricalDateWindowQuery({
        period: 'range',
        from: '2026-05-01',
        to: '2026-06-01'
      })
    ).toBe('Rentang tanggal custom maksimal 31 hari');
  });
});
