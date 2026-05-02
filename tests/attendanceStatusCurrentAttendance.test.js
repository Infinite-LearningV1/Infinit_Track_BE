import { jest } from '@jest/globals';

describe('getAttendanceStatus current attendance mode', () => {
  function buildRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  }

  function buildModelsMock({ attendance = null, booking = null, location = null } = {}) {
    return {
      Attendance: {
        findOne: jest.fn().mockResolvedValue(attendance)
      },
      Booking: { findOne: jest.fn().mockResolvedValue(booking) },
      Location: { findOne: jest.fn().mockResolvedValue(location) },
      Settings: {
        findAll: jest.fn().mockResolvedValue([
          { setting_key: 'checkin.start_time', setting_value: '08:00:00' },
          { setting_key: 'checkin.end_time', setting_value: '18:00:00' },
          { setting_key: 'checkout.auto_time', setting_value: '17:00:00' },
          { setting_key: 'workday.holiday_checkin_enabled', setting_value: 'false' },
          { setting_key: 'workday.holiday_region', setting_value: 'ID' }
        ])
      },
      AttendanceCategory: {},
      AttendanceStatus: {},
      BookingStatus: {},
      User: {},
      Role: {},
      LocationEvent: {},
      Photo: {}
    };
  }

  function mockControllerDependencies({ models, holidayInfo = false }) {
    jest.unstable_mockModule('../src/config/database.js', () => ({
      default: { transaction: jest.fn() }
    }));

    jest.unstable_mockModule('../src/models/index.js', () => models);

    jest.unstable_mockModule('date-holidays', () => ({
      default: jest.fn().mockImplementation(() => ({
        isHoliday: jest.fn(() => holidayInfo)
      }))
    }));

    jest.unstable_mockModule('../src/utils/geofence.js', () => ({
      calculateDistance: jest.fn(),
      getJakartaTime: jest.fn(),
      getJakartaDateString: jest.fn(),
      getCurrentTimeForDB: jest.fn(),
      toJakartaTime: jest.fn((d) => d)
    }));

    jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
      formatWorkHour: jest.fn(),
      calculateWorkHour: jest.fn(),
      formatTimeOnly: jest.fn(() => '09:00:00')
    }));

    jest.unstable_mockModule('../src/utils/searchHelper.js', () => ({
      applySearch: jest.fn()
    }));

    jest.unstable_mockModule('../src/utils/settings.js', () => ({
      getOperationalSettings: jest.fn().mockResolvedValue({ geofenceRadiusDefaultM: 100 })
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
      default: { info: jest.fn(), error: jest.fn(), debug: jest.fn() }
    }));

    jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
      default: {}
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
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('uses current WFH attendance location instead of WFO fallback for active mode', async () => {
    const wfhLocation = {
      location_id: 22,
      latitude: '-0.8917',
      longitude: '119.8707',
      radius: 150,
      description: 'Rumah Pegawai',
      address: 'Jl. WFH Palu',
      attendance_category: {
        category_name: 'Work From Home'
      }
    };

    const wfoLocation = {
      location_id: 1,
      latitude: '-6.2088',
      longitude: '106.8456',
      radius: 100,
      description: 'Kantor Pusat Jakarta',
      address: 'Jl. Sudirman No. 1, Jakarta Pusat'
    };

    const models = buildModelsMock({
      attendance: {
        user_id: 7,
        attendance_date: '2026-04-14',
        time_in: new Date('2026-04-14T09:00:00+07:00'),
        time_out: null,
        location: wfhLocation
      },
      location: wfoLocation
    });
    mockControllerDependencies({ models });

    const { getAttendanceStatus } = await import('../src/controllers/attendance.controller.js');

    const req = {
      user: { id: 7 },
      query: { now: '2026-04-14T10:00:00+07:00' },
      headers: {}
    };
    const res = buildRes();
    const next = jest.fn();

    await getAttendanceStatus(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          active_mode: 'Work From Home',
          active_location: expect.objectContaining({
            location_id: 22,
            description: 'Rumah Pegawai',
            category: 'Work From Home'
          })
        })
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('coerces holiday library truthy payload into boolean is_holiday in status response', async () => {
    const holidayPayload = [{ name: 'Hari Buruh Internasional' }];
    const models = buildModelsMock();
    mockControllerDependencies({ models, holidayInfo: holidayPayload });

    const { getAttendanceStatus } = await import('../src/controllers/attendance.controller.js');

    const req = {
      user: { id: 8 },
      query: { now: '2026-05-01T10:00:00+07:00' },
      headers: {}
    };
    const res = buildRes();
    const next = jest.fn();

    await getAttendanceStatus(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          is_holiday: true
        })
      })
    );
    expect(typeof res.json.mock.calls[0][0].data.is_holiday).toBe('boolean');
    expect(next).not.toHaveBeenCalled();
  });
});
