import { jest } from '@jest/globals';

const mockSettingsFindAll = jest.fn();

jest.unstable_mockModule('../src/models/index.js', () => ({
  Settings: { findAll: mockSettingsFindAll }
}));

const {
  OPERATIONAL_SETTING_KEYS,
  OPERATIONAL_SETTING_DEFAULTS,
  getOperationalSettings
} = await import('../src/utils/settings.js');

describe('operational settings accessor', () => {
  beforeEach(() => {
    mockSettingsFindAll.mockReset();
  });

  it('fetches operational settings in one DB query and returns typed values', async () => {
    mockSettingsFindAll.mockResolvedValueOnce([
      { setting_key: 'attendance.geofence.radius_default_m', setting_value: '150' },
      { setting_key: 'attendance.auto_checkout.idle_min', setting_value: '12' },
      { setting_key: 'attendance.auto_checkout.tbuffer_min', setting_value: '45' },
      { setting_key: 'attendance.auto_checkout.late_tolerance_min', setting_value: '20' },
      { setting_key: 'checkout.fallback_time', setting_value: '18:30:00' }
    ]);

    const settings = await getOperationalSettings();

    expect(mockSettingsFindAll).toHaveBeenCalledTimes(1);
    expect(mockSettingsFindAll.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        transaction: null,
        where: expect.objectContaining({
          setting_key: expect.any(Object)
        })
      })
    );
    expect(settings).toEqual({
      geofenceRadiusDefaultM: 150,
      autoCheckoutIdleMin: 12,
      autoCheckoutTBufferMin: 45,
      lateCheckoutToleranceMin: 20,
      defaultShiftEnd: '18:30:00'
    });
  });

  it('uses code-level safe defaults when DB rows are missing or invalid', async () => {
    mockSettingsFindAll.mockResolvedValueOnce([
      { setting_key: 'attendance.geofence.radius_default_m', setting_value: 'not-a-number' },
      { setting_key: 'attendance.auto_checkout.idle_min', setting_value: '' },
      { setting_key: 'attendance.auto_checkout.tbuffer_min', setting_value: '-5' },
      { setting_key: 'attendance.auto_checkout.late_tolerance_min', setting_value: '0' },
      { setting_key: 'checkout.fallback_time', setting_value: '17:00' }
    ]);

    const settings = await getOperationalSettings();

    expect(settings).toEqual(OPERATIONAL_SETTING_DEFAULTS);
  });

  it('normalizes checkout fallback time from HH:mm to HH:mm:ss', async () => {
    mockSettingsFindAll.mockResolvedValueOnce([
      { setting_key: 'checkout.fallback_time', setting_value: '18:30' }
    ]);

    const settings = await getOperationalSettings();

    expect(settings.defaultShiftEnd).toBe('18:30:00');
  });

  it('exports stable DB keys and defaults for consumers', () => {
    expect(OPERATIONAL_SETTING_KEYS).toEqual({
      geofenceRadiusDefaultM: 'attendance.geofence.radius_default_m',
      autoCheckoutIdleMin: 'attendance.auto_checkout.idle_min',
      autoCheckoutTBufferMin: 'attendance.auto_checkout.tbuffer_min',
      lateCheckoutToleranceMin: 'attendance.auto_checkout.late_tolerance_min',
      defaultShiftEnd: 'checkout.fallback_time'
    });

    expect(OPERATIONAL_SETTING_DEFAULTS).toEqual({
      geofenceRadiusDefaultM: 100,
      autoCheckoutIdleMin: 10,
      autoCheckoutTBufferMin: 30,
      lateCheckoutToleranceMin: 15,
      defaultShiftEnd: '17:00:00'
    });
  });
});
