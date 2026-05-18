import { jest } from '@jest/globals';

const mockSettingsFindAll = jest.fn();
const mockSettingsFindByPk = jest.fn();
const mockSettingsCreate = jest.fn();
const mockTransaction = jest.fn();

jest.unstable_mockModule('../src/models/index.js', () => ({
  Settings: {
    findAll: mockSettingsFindAll,
    findByPk: mockSettingsFindByPk,
    create: mockSettingsCreate
  },
  sequelize: {
    transaction: mockTransaction
  }
}));

const {
  OPERATIONAL_SETTING_KEYS,
  OPERATIONAL_SETTING_DEFAULTS,
  OPERATIONAL_SETTING_FIELDS,
  OPERATIONAL_SETTING_INTEGER_FIELDS,
  OPERATIONAL_SETTING_TIME_FIELDS,
  normalizeOperationalSettingTime,
  normalizeOperationalSettingValue,
  normalizeOperationalSettings,
  serializeOperationalSettingValue,
  getOperationalSettings,
  getOperationalSettingsStrict,
  getAttendanceSettings
} = await import('../src/utils/settings.js');
const { updateOperationalSettings } = await import('../src/services/operationalSettings.service.js');

describe('operational settings accessor', () => {
  beforeEach(() => {
    mockSettingsFindAll.mockReset();
    mockSettingsFindByPk.mockReset();
    mockSettingsCreate.mockReset();
    mockTransaction.mockReset();
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

  it('fails strict reads when an approved operational setting row is missing or invalid', async () => {
    mockSettingsFindAll.mockResolvedValueOnce([
      { setting_key: 'attendance.auto_checkout.idle_min', setting_value: '10' },
      { setting_key: 'attendance.auto_checkout.tbuffer_min', setting_value: '30' },
      { setting_key: 'attendance.auto_checkout.late_tolerance_min', setting_value: 'invalid' },
      { setting_key: 'checkout.fallback_time', setting_value: '17:00:00' }
    ]);

    await expect(getOperationalSettingsStrict()).rejects.toMatchObject({
      message: expect.stringContaining('Operational settings are incomplete or invalid'),
      status: 500,
      code: 'E_OPERATIONAL_SETTINGS_INVALID',
      details: expect.arrayContaining([
        expect.objectContaining({ field: 'geofenceRadiusDefaultM', issue: 'missing' }),
        expect.objectContaining({ field: 'lateCheckoutToleranceMin', issue: 'invalid' })
      ])
    });
  });

  it('keeps permissive reads for legacy consumers when settings rows are incomplete', async () => {
    mockSettingsFindAll.mockResolvedValueOnce([
      { setting_key: 'attendance.auto_checkout.idle_min', setting_value: '10' },
      { setting_key: 'attendance.auto_checkout.late_tolerance_min', setting_value: 'invalid' },
      { setting_key: 'checkout.fallback_time', setting_value: '17:00:00' }
    ]);

    await expect(getOperationalSettings()).resolves.toEqual({
      geofenceRadiusDefaultM: 100,
      autoCheckoutIdleMin: 10,
      autoCheckoutTBufferMin: 30,
      lateCheckoutToleranceMin: 15,
      defaultShiftEnd: '17:00:00'
    });
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

    expect(OPERATIONAL_SETTING_FIELDS).toEqual([
      'geofenceRadiusDefaultM',
      'autoCheckoutIdleMin',
      'autoCheckoutTBufferMin',
      'lateCheckoutToleranceMin',
      'defaultShiftEnd'
    ]);
    expect(OPERATIONAL_SETTING_INTEGER_FIELDS).toEqual([
      'geofenceRadiusDefaultM',
      'autoCheckoutIdleMin',
      'autoCheckoutTBufferMin',
      'lateCheckoutToleranceMin'
    ]);
    expect(OPERATIONAL_SETTING_TIME_FIELDS).toEqual(['defaultShiftEnd']);
  });

  it('normalizes and serializes operational setting values consistently', () => {
    expect(normalizeOperationalSettingTime('18:00')).toBe('18:00:00');
    expect(normalizeOperationalSettingTime('18:00:30')).toBe('18:00:30');
    expect(normalizeOperationalSettingTime('18')).toBeNull();

    expect(normalizeOperationalSettingValue('geofenceRadiusDefaultM', '120')).toBe(120);
    expect(normalizeOperationalSettingValue('geofenceRadiusDefaultM', 0)).toBeNull();
    expect(normalizeOperationalSettingValue('defaultShiftEnd', '19:15')).toBe('19:15:00');
    expect(normalizeOperationalSettingValue('defaultShiftEnd', '19:15:30')).toBe('19:15:30');
    expect(normalizeOperationalSettingValue('defaultShiftEnd', '19')).toBeNull();

    expect(serializeOperationalSettingValue('autoCheckoutIdleMin', 12)).toBe('12');
    expect(serializeOperationalSettingValue('defaultShiftEnd', '19:15')).toBe('19:15:00');
    expect(serializeOperationalSettingValue('defaultShiftEnd', '19')).toBeNull();
  });

  it('fills defaults when normalizing partial operational settings objects', () => {
    expect(
      normalizeOperationalSettings({
        autoCheckoutIdleMin: '22',
        defaultShiftEnd: '19:30'
      })
    ).toEqual({
      geofenceRadiusDefaultM: 100,
      autoCheckoutIdleMin: 22,
      autoCheckoutTBufferMin: 30,
      lateCheckoutToleranceMin: 15,
      defaultShiftEnd: '19:30:00'
    });
  });

  it('rejects invalid payloads at the service boundary before starting a transaction', async () => {
    await expect(updateOperationalSettings({ unknownField: 1 })).rejects.toMatchObject({
      message: 'Unknown operational setting field: unknownField',
      status: 400
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('only persists fields explicitly provided in the patch payload', async () => {
    const transaction = {};
    const existingGeofenceSetting = { update: jest.fn().mockResolvedValue(undefined) };
    const existingIdleSetting = { update: jest.fn().mockResolvedValue(undefined) };
    const existingBufferSetting = { update: jest.fn().mockResolvedValue(undefined) };
    const existingLateToleranceSetting = { update: jest.fn().mockResolvedValue(undefined) };
    const existingShiftEndSetting = { update: jest.fn().mockResolvedValue(undefined) };

    mockTransaction.mockImplementation(async (callback) => callback(transaction));
    mockSettingsFindAll
      .mockResolvedValueOnce([
        { setting_key: 'attendance.geofence.radius_default_m', setting_value: 'not-a-number' },
        { setting_key: 'attendance.auto_checkout.idle_min', setting_value: '10' },
        { setting_key: 'attendance.auto_checkout.tbuffer_min', setting_value: '30' },
        { setting_key: 'attendance.auto_checkout.late_tolerance_min', setting_value: '15' },
        { setting_key: 'checkout.fallback_time', setting_value: '17:00:00' }
      ])
      .mockResolvedValueOnce([
        { setting_key: 'attendance.geofence.radius_default_m', setting_value: 'not-a-number' },
        { setting_key: 'attendance.auto_checkout.idle_min', setting_value: '12' },
        { setting_key: 'attendance.auto_checkout.tbuffer_min', setting_value: '30' },
        { setting_key: 'attendance.auto_checkout.late_tolerance_min', setting_value: '15' },
        { setting_key: 'checkout.fallback_time', setting_value: '17:00:00' }
      ]);

    mockSettingsFindByPk.mockImplementation(async (settingKey) => {
      switch (settingKey) {
        case OPERATIONAL_SETTING_KEYS.geofenceRadiusDefaultM:
          return existingGeofenceSetting;
        case OPERATIONAL_SETTING_KEYS.autoCheckoutIdleMin:
          return existingIdleSetting;
        case OPERATIONAL_SETTING_KEYS.autoCheckoutTBufferMin:
          return existingBufferSetting;
        case OPERATIONAL_SETTING_KEYS.lateCheckoutToleranceMin:
          return existingLateToleranceSetting;
        case OPERATIONAL_SETTING_KEYS.defaultShiftEnd:
          return existingShiftEndSetting;
        default:
          return null;
      }
    });

    await expect(updateOperationalSettings({ autoCheckoutIdleMin: 12 })).rejects.toMatchObject({
      message: expect.stringContaining('Operational settings are incomplete or invalid'),
      status: 500,
      code: 'E_OPERATIONAL_SETTINGS_INVALID',
      details: expect.arrayContaining([
        expect.objectContaining({ field: 'geofenceRadiusDefaultM', issue: 'invalid' })
      ])
    });

    expect(existingGeofenceSetting.update).not.toHaveBeenCalled();
    expect(existingIdleSetting.update).toHaveBeenCalledWith(
      expect.objectContaining({ setting_value: '12' }),
      expect.objectContaining({ transaction })
    );
    expect(existingBufferSetting.update).not.toHaveBeenCalled();
    expect(existingLateToleranceSetting.update).not.toHaveBeenCalled();
    expect(existingShiftEndSetting.update).not.toHaveBeenCalled();
    expect(mockSettingsCreate).not.toHaveBeenCalled();
  });

  it('returns the latest full typed state when the post-update settings are fully valid', async () => {
    const transaction = {};
    const existingIdleSetting = { update: jest.fn().mockResolvedValue(undefined) };

    mockTransaction.mockImplementation(async (callback) => callback(transaction));
    mockSettingsFindAll
      .mockResolvedValueOnce([
        { setting_key: 'attendance.geofence.radius_default_m', setting_value: '100' },
        { setting_key: 'attendance.auto_checkout.idle_min', setting_value: '10' },
        { setting_key: 'attendance.auto_checkout.tbuffer_min', setting_value: '30' },
        { setting_key: 'attendance.auto_checkout.late_tolerance_min', setting_value: '15' },
        { setting_key: 'checkout.fallback_time', setting_value: '17:00:00' }
      ])
      .mockResolvedValueOnce([
        { setting_key: 'attendance.geofence.radius_default_m', setting_value: '100' },
        { setting_key: 'attendance.auto_checkout.idle_min', setting_value: '12' },
        { setting_key: 'attendance.auto_checkout.tbuffer_min', setting_value: '30' },
        { setting_key: 'attendance.auto_checkout.late_tolerance_min', setting_value: '15' },
        { setting_key: 'checkout.fallback_time', setting_value: '17:00:00' }
      ]);

    mockSettingsFindByPk.mockImplementation(async (settingKey) => {
      if (settingKey === OPERATIONAL_SETTING_KEYS.autoCheckoutIdleMin) {
        return existingIdleSetting;
      }

      return null;
    });

    await expect(updateOperationalSettings({ autoCheckoutIdleMin: 12 })).resolves.toEqual({
      geofenceRadiusDefaultM: 100,
      autoCheckoutIdleMin: 12,
      autoCheckoutTBufferMin: 30,
      lateCheckoutToleranceMin: 15,
      defaultShiftEnd: '17:00:00'
    });

    expect(existingIdleSetting.update).toHaveBeenCalledWith(
      expect.objectContaining({ setting_value: '12' }),
      expect.objectContaining({ transaction })
    );
  });

  it('creates a missing approved setting row when that field is explicitly patched', async () => {
    const transaction = {};

    mockTransaction.mockImplementation(async (callback) => callback(transaction));
    mockSettingsFindAll
      .mockResolvedValueOnce([
        { setting_key: 'attendance.geofence.radius_default_m', setting_value: '100' },
        { setting_key: 'attendance.auto_checkout.idle_min', setting_value: '10' },
        { setting_key: 'attendance.auto_checkout.tbuffer_min', setting_value: '30' },
        { setting_key: 'attendance.auto_checkout.late_tolerance_min', setting_value: '15' }
      ])
      .mockResolvedValueOnce([
        { setting_key: 'attendance.geofence.radius_default_m', setting_value: '100' },
        { setting_key: 'attendance.auto_checkout.idle_min', setting_value: '10' },
        { setting_key: 'attendance.auto_checkout.tbuffer_min', setting_value: '30' },
        { setting_key: 'attendance.auto_checkout.late_tolerance_min', setting_value: '15' },
        { setting_key: 'checkout.fallback_time', setting_value: '18:00:00' }
      ]);

    mockSettingsFindByPk.mockResolvedValueOnce(null);
    mockSettingsCreate.mockResolvedValueOnce(undefined);

    await expect(updateOperationalSettings({ defaultShiftEnd: '18:00' })).resolves.toEqual({
      geofenceRadiusDefaultM: 100,
      autoCheckoutIdleMin: 10,
      autoCheckoutTBufferMin: 30,
      lateCheckoutToleranceMin: 15,
      defaultShiftEnd: '18:00:00'
    });

    expect(mockSettingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        setting_key: OPERATIONAL_SETTING_KEYS.defaultShiftEnd,
        setting_value: '18:00:00',
        description: null
      }),
      expect.objectContaining({ transaction })
    );
  });

  it('skips writes when an explicitly patched payload does not change stored values', async () => {
    const transaction = {};

    mockTransaction.mockImplementation(async (callback) => callback(transaction));
    mockSettingsFindAll
      .mockResolvedValueOnce([
        { setting_key: 'attendance.geofence.radius_default_m', setting_value: '100' },
        { setting_key: 'attendance.auto_checkout.idle_min', setting_value: '10' },
        { setting_key: 'attendance.auto_checkout.tbuffer_min', setting_value: '30' },
        { setting_key: 'attendance.auto_checkout.late_tolerance_min', setting_value: '15' },
        { setting_key: 'checkout.fallback_time', setting_value: '17:00:00' }
      ])
      .mockResolvedValueOnce([
        { setting_key: 'attendance.geofence.radius_default_m', setting_value: '100' },
        { setting_key: 'attendance.auto_checkout.idle_min', setting_value: '10' },
        { setting_key: 'attendance.auto_checkout.tbuffer_min', setting_value: '30' },
        { setting_key: 'attendance.auto_checkout.late_tolerance_min', setting_value: '15' },
        { setting_key: 'checkout.fallback_time', setting_value: '17:00:00' }
      ]);

    await expect(
      updateOperationalSettings({ autoCheckoutIdleMin: 10, defaultShiftEnd: '17:00:00' })
    ).resolves.toEqual({
      geofenceRadiusDefaultM: 100,
      autoCheckoutIdleMin: 10,
      autoCheckoutTBufferMin: 30,
      lateCheckoutToleranceMin: 15,
      defaultShiftEnd: '17:00:00'
    });

    expect(mockSettingsFindByPk).not.toHaveBeenCalled();
    expect(mockSettingsCreate).not.toHaveBeenCalled();
  });

  it('preserves the original attendance settings error instead of wrapping it', async () => {
    const dbError = Object.assign(new Error('database unavailable'), {
      code: 'E_DB_DOWN',
      status: 503
    });

    mockSettingsFindAll.mockRejectedValueOnce(dbError);

    await expect(getAttendanceSettings()).rejects.toBe(dbError);
  });
});
