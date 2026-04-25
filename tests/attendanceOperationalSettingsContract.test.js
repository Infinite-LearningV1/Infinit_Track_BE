import { jest } from '@jest/globals';

const mockAttendanceFindOne = jest.fn();
const mockAttendanceFindAll = jest.fn();
const mockBookingFindOne = jest.fn();
const mockLocationFindOne = jest.fn();
const mockSettingsFindAll = jest.fn();
const mockSettingsFindOne = jest.fn();

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: { transaction: jest.fn() }
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: {
    findOne: mockAttendanceFindOne,
    findAll: mockAttendanceFindAll
  },
  Booking: { findOne: mockBookingFindOne },
  Location: { findOne: mockLocationFindOne },
  Settings: {
    findAll: mockSettingsFindAll,
    findOne: mockSettingsFindOne
  },
  AttendanceCategory: {},
  AttendanceStatus: {},
  BookingStatus: {},
  User: {},
  Role: {},
  LocationEvent: {}
}));

jest.unstable_mockModule('../src/utils/settings.js', () => ({
  getOperationalSettings: jest.fn(async () => ({
    geofenceRadiusDefaultM: 150,
    autoCheckoutIdleMin: 12,
    autoCheckoutTBufferMin: 45,
    lateCheckoutToleranceMin: 20,
    defaultShiftEnd: '18:30:00'
  }))
}));

jest.unstable_mockModule('../src/jobs/autoCheckout.job.js', () => ({
  triggerAutoCheckout: jest.fn(),
  runSmartAutoCheckoutForDate: jest.fn()
}));

jest.unstable_mockModule('../src/jobs/resolveWfaBookings.job.js', () => ({
  triggerResolveWfaBookings: jest.fn(),
  resolveWfaBookingsForDate: jest.fn()
}));

jest.unstable_mockModule('../src/jobs/createGeneralAlpha.job.js', () => ({
  runGeneralAlphaForDate: jest.fn()
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() }
}));

const {
  getSmartEngineConfig,
  getEnhancedAutoCheckoutSettings,
  getAttendanceStatus
} = await import('../src/controllers/attendance.controller.js');

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('attendance operational settings contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAttendanceFindOne.mockResolvedValue(null);
    mockAttendanceFindAll.mockResolvedValue([]);
    mockBookingFindOne.mockResolvedValue(null);
    mockLocationFindOne.mockResolvedValue(null);
    mockSettingsFindAll.mockResolvedValue([]);
    mockSettingsFindOne.mockResolvedValue(null);
  });

  it('getSmartEngineConfig exposes DB-backed flagger config values', async () => {
    const req = { user: { role_name: 'Admin' } };
    const res = buildRes();
    const next = jest.fn();

    await getSmartEngineConfig(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          flagger_config: expect.objectContaining({
            late_checkout_tolerance_min: 20,
            default_shift_end: '18:30:00'
          })
        })
      })
    );
  });

  it('getEnhancedAutoCheckoutSettings returns DB-backed operational auto-checkout config', async () => {
    const req = { user: { role_name: 'Admin' } };
    const res = buildRes();
    const next = jest.fn();

    await getEnhancedAutoCheckoutSettings(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          operational_settings: expect.objectContaining({
            auto_checkout_idle_min: 12,
            auto_checkout_tbuffer_min: 45,
            late_checkout_tolerance_min: 20,
            default_shift_end: '18:30:00'
          })
        })
      })
    );
  });

  it('getAttendanceStatus fallback WFO location uses DB-backed default geofence radius', async () => {
    const req = {
      user: { id: 101 },
      query: { now: '2026-04-22T02:00:00.000Z' },
      headers: {}
    };
    const res = buildRes();
    const next = jest.fn();

    await getAttendanceStatus(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          active_mode: 'Work From Office',
          active_location: expect.objectContaining({
            radius: 150
          })
        })
      })
    );
  });
});
