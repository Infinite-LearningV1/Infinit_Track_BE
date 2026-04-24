import { jest } from '@jest/globals';

const mockAttendanceFindAll = jest.fn();
const mockFormatTimeOnly = jest.fn(() => '08:15');
const mockGetJakartaDateString = jest.fn(() => '2026-04-22');

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {}
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: { findAll: mockAttendanceFindAll },
  Booking: { findOne: jest.fn() },
  Location: { findOne: jest.fn() },
  Settings: { findAll: jest.fn(), findOne: jest.fn() },
  AttendanceCategory: {},
  AttendanceStatus: {},
  BookingStatus: {},
  User: {},
  Role: {},
  Division: {},
  Program: {},
  Position: {},
  LocationEvent: {},
  Photo: {}
}));

jest.unstable_mockModule('../src/utils/geofence.js', () => ({
  calculateDistance: jest.fn(() => 0),
  getJakartaTime: jest.fn(() => new Date('2026-04-22T09:00:00+07:00')),
  getJakartaDateString: mockGetJakartaDateString,
  getCurrentTimeForDB: jest.fn(() => new Date('2026-04-22T09:00:00+07:00')),
  toJakartaTime: jest.fn((d) => d)
}));

jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
  formatWorkHour: jest.fn(),
  calculateWorkHour: jest.fn(),
  formatTimeOnly: mockFormatTimeOnly
}));

jest.unstable_mockModule('../src/utils/searchHelper.js', () => ({
  applySearch: jest.fn()
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

const buildRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis()
});

describe('attendance today locations handler', () => {
  beforeEach(() => {
    mockAttendanceFindAll.mockReset();
    mockFormatTimeOnly.mockClear();
    mockGetJakartaDateString.mockClear();
  });

  it('returns hero map payload for mapped users checked in today', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([
      {
        user: {
          id_users: 7,
          full_name: 'Febri',
          photo_file: { photo_url: 'https://cdn.example.com/photos/febri.jpg' }
        },
        location: { latitude: '-0.8917', longitude: '119.8707' },
        attendance_category: { category_name: 'Work From Office' },
        time_in: new Date('2026-04-22T08:15:00+07:00')
      }
    ]);

    const { getTodayLocations } = await import('../src/controllers/attendance.controller.js');
    const req = { user: { id: 1, role_name: 'Admin' } };
    const res = buildRes();
    const next = jest.fn();

    await getTodayLocations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockGetJakartaDateString).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          date: '2026-04-22',
          timezone: 'Asia/Jakarta',
          total_users: 1,
          locations: [
            expect.objectContaining({
              user_id: 7,
              full_name: 'Febri',
              photo: 'https://cdn.example.com/photos/febri.jpg',
              status: 'WFO',
              check_in_time: '08:15',
              latitude: -0.8917,
              longitude: 119.8707
            })
          ]
        })
      })
    );
  });

  it('returns 200 with empty locations array when no mapped users exist', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([]);

    const { getTodayLocations } = await import('../src/controllers/attendance.controller.js');
    const req = { user: { id: 1, role_name: 'Admin' } };
    const res = buildRes();
    const next = jest.fn();

    await getTodayLocations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          total_users: 0,
          locations: []
        })
      })
    );
  });

  it('excludes rows with invalid coordinates or unsupported category values', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([
      {
        user: {
          id_users: 7,
          full_name: 'Febri',
          photo_file: null
        },
        location: { latitude: null, longitude: '119.8707' },
        attendance_category: { category_name: 'WFO' },
        time_in: new Date('2026-04-22T08:15:00+07:00')
      },
      {
        user: {
          id_users: 8,
          full_name: 'Diana',
          photo_file: null
        },
        location: { latitude: '-0.9000', longitude: '119.8800' },
        attendance_category: { category_name: 'WFH' },
        time_in: new Date('2026-04-22T08:30:00+07:00')
      },
      {
        user: {
          id_users: 9,
          full_name: 'Rudi',
          photo_file: null
        },
        location: { latitude: '-0.9100', longitude: '119.8900' },
        attendance_category: { category_name: 'Unknown' },
        time_in: new Date('2026-04-22T08:45:00+07:00')
      }
    ]);

    const { getTodayLocations } = await import('../src/controllers/attendance.controller.js');
    const req = { user: { id: 1, role_name: 'Admin' } };
    const res = buildRes();
    const next = jest.fn();

    await getTodayLocations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          total_users: 1,
          locations: [
            expect.objectContaining({
              user_id: 8,
              status: 'WFH'
            })
          ]
        })
      })
    );
  });
});
