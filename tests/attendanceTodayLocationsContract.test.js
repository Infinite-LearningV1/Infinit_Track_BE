import { jest } from '@jest/globals';
import { Op } from 'sequelize';

const mockAttendanceFindAll = jest.fn();
const mockAttendanceCount = jest.fn();
const mockLocationFindOne = jest.fn();
const mockFormatTimeOnly = jest.fn(() => '08:15');
const mockGetJakartaDateString = jest.fn(() => '2026-04-22');

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {}
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: { count: mockAttendanceCount, findAll: mockAttendanceFindAll },
  Booking: { findOne: jest.fn() },
  Location: { findOne: mockLocationFindOne },
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

const buildAttendanceRow = ({
  userId,
  fullName,
  categoryName = 'Work From Office',
  latitude = '-0.8917',
  longitude = '119.8707',
  photoUrl = null,
  timeIn = new Date('2026-04-22T08:15:00+07:00')
}) => ({
  user: {
    id_users: userId,
    full_name: fullName,
    photo_file: photoUrl ? { photo_url: photoUrl } : null
  },
  location: { latitude, longitude },
  attendance_category: { category_name: categoryName },
  time_in: timeIn
});

describe('attendance today locations handler', () => {
  const originalHeroMapMaxUsers = process.env.HERO_MAP_MAX_USERS;

  beforeEach(() => {
    mockAttendanceFindAll.mockReset();
    mockAttendanceCount.mockReset();
    mockAttendanceCount.mockResolvedValue(0);
    mockLocationFindOne.mockReset();
    mockFormatTimeOnly.mockClear();
    mockGetJakartaDateString.mockClear();
    delete process.env.HERO_MAP_MAX_USERS;
  });

  afterAll(() => {
    if (originalHeroMapMaxUsers == null) {
      delete process.env.HERO_MAP_MAX_USERS;
    } else {
      process.env.HERO_MAP_MAX_USERS = originalHeroMapMaxUsers;
    }
  });

  it('returns hero map payload for mapped users checked in today as context-only evidence', async () => {
    mockAttendanceCount.mockResolvedValueOnce(1);
    mockAttendanceFindAll.mockResolvedValueOnce([
      buildAttendanceRow({
        userId: 7,
        fullName: 'Febri',
        photoUrl: 'https://cdn.example.com/photos/febri.jpg'
      })
    ]);

    const { getTodayLocations } = await import('../src/controllers/attendance.controller.js');
    const req = { user: { id: 1, role_name: 'Admin' }, query: {} };
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
          snapshot_type: 'attendance_checkin_snapshot',
          is_live_tracking: false,
          authority: 'context_only',
          final_attendance_authority: 'attendance_records',
          total_users: 1,
          truncated: false,
          truncated_at: null,
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
    const req = { user: { id: 1, role_name: 'Admin' }, query: {} };
    const res = buildRes();
    const next = jest.fn();

    await getTodayLocations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          snapshot_type: 'attendance_checkin_snapshot',
          is_live_tracking: false,
          authority: 'context_only',
          final_attendance_authority: 'attendance_records',
          total_users: 0,
          truncated: false,
          truncated_at: null,
          locations: []
        })
      })
    );
  });

  it('returns all mapped users when requested limit is above the mappable user count', async () => {
    mockAttendanceCount.mockResolvedValueOnce(2);
    mockAttendanceFindAll.mockResolvedValueOnce([
      buildAttendanceRow({ userId: 7, fullName: 'Febri' }),
      buildAttendanceRow({ userId: 8, fullName: 'Diana', categoryName: 'Work From Anywhere' })
    ]);

    const { getTodayLocations } = await import('../src/controllers/attendance.controller.js');
    const req = { user: { id: 1, role_name: 'Admin' }, query: { limit: '5' } };
    const res = buildRes();
    const next = jest.fn();

    await getTodayLocations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockAttendanceFindAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total_users: 2,
          truncated: false,
          truncated_at: null,
          locations: [
            expect.objectContaining({ user_id: 7, status: 'WFO' }),
            expect.objectContaining({ user_id: 8, status: 'WFA' })
          ]
        })
      })
    );
  });

  it('excludes rows with invalid coordinates or unsupported category values', async () => {
    mockAttendanceCount.mockResolvedValueOnce(1);
    mockAttendanceFindAll.mockResolvedValueOnce([
      buildAttendanceRow({ userId: 7, fullName: 'Febri', latitude: null }),
      buildAttendanceRow({ userId: 8, fullName: 'Diana', categoryName: 'WFH' }),
      buildAttendanceRow({ userId: 9, fullName: 'Rudi', categoryName: 'Unknown' })
    ]);

    const { getTodayLocations } = await import('../src/controllers/attendance.controller.js');
    const req = { user: { id: 1, role_name: 'Admin' }, query: {} };
    const res = buildRes();
    const next = jest.fn();

    await getTodayLocations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          snapshot_type: 'attendance_checkin_snapshot',
          is_live_tracking: false,
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

  it('truncates response locations using the optional query limit without changing today-only semantics', async () => {
    mockAttendanceCount.mockResolvedValueOnce(2);
    mockAttendanceFindAll.mockResolvedValueOnce([
      buildAttendanceRow({ userId: 7, fullName: 'Febri' })
    ]);

    const { getTodayLocations } = await import('../src/controllers/attendance.controller.js');
    const req = {
      user: { id: 1, role_name: 'Admin' },
      query: { limit: '1', period: 'custom', from: '2026-04-01', to: '2026-04-30' }
    };
    const res = buildRes();
    const next = jest.fn();

    await getTodayLocations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockAttendanceFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 1,
        where: expect.objectContaining({ attendance_date: '2026-04-22' })
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          date: '2026-04-22',
          total_users: 2,
          truncated: true,
          truncated_at: 1,
          locations: [expect.objectContaining({ user_id: 7 })]
        })
      })
    );
  });

  it.each([
    ['2026-04-22 23:55 WIB', '2026-04-22'],
    ['2026-04-23 00:05 WIB', '2026-04-23']
  ])('uses the resolved Jakarta date at %s for the today-only query', async (_label, date) => {
    mockGetJakartaDateString.mockReturnValueOnce(date);
    mockAttendanceFindAll.mockResolvedValueOnce([]);

    const { getTodayLocations } = await import('../src/controllers/attendance.controller.js');
    const req = { user: { id: 1, role_name: 'Admin' }, query: {} };
    const res = buildRes();
    const next = jest.fn();

    await getTodayLocations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockAttendanceCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ attendance_date: date })
      })
    );
    expect(mockAttendanceFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ attendance_date: date })
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ date })
      })
    );
  });

  it('uses HERO_MAP_MAX_USERS as the default query and response hard cap', async () => {
    process.env.HERO_MAP_MAX_USERS = '1';
    mockAttendanceCount.mockResolvedValueOnce(2);
    mockAttendanceFindAll.mockResolvedValueOnce([
      buildAttendanceRow({ userId: 7, fullName: 'Febri' })
    ]);

    const { getTodayLocations } = await import('../src/controllers/attendance.controller.js');
    const req = { user: { id: 1, role_name: 'Admin' }, query: {} };
    const res = buildRes();
    const next = jest.fn();

    await getTodayLocations(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockAttendanceFindAll).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total_users: 2,
          truncated: true,
          truncated_at: 1,
          locations: [expect.objectContaining({ user_id: 7 })]
        })
      })
    );
  });

  it.each(['0', '-1', '1.5', '10abc', 'abc', ''])('rejects invalid limit value %p', async (limit) => {
    const { getTodayLocations } = await import('../src/controllers/attendance.controller.js');
    const req = { user: { id: 1, role_name: 'Admin' }, query: { limit } };
    const res = buildRes();
    const next = jest.fn();

    await getTodayLocations(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(mockAttendanceCount).not.toHaveBeenCalled();
    expect(mockAttendanceFindAll).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 400,
        message: 'limit must be a positive integer'
      })
    );
  });

  it('keeps related user photo, location, and category data eager-loaded for the main query', async () => {
    mockAttendanceFindAll.mockResolvedValueOnce([]);

    const { getTodayLocations } = await import('../src/controllers/attendance.controller.js');
    const req = { user: { id: 1, role_name: 'Admin' }, query: {} };
    const res = buildRes();
    const next = jest.fn();

    await getTodayLocations(req, res, next);

    expect(mockAttendanceFindAll).toHaveBeenCalledTimes(1);
    expect(mockLocationFindOne).not.toHaveBeenCalled();

    const [findAllOptions] = mockAttendanceFindAll.mock.calls[0];
    const userInclude = findAllOptions.include.find((include) => include.as === 'user');
    const locationInclude = findAllOptions.include.find((include) => include.as === 'location');
    const attendanceCategoryInclude = findAllOptions.include.find((include) => include.as === 'attendance_category');

    expect(userInclude).toEqual(
      expect.objectContaining({
        as: 'user',
        include: [expect.objectContaining({ as: 'photo_file', required: false })]
      })
    );
    expect(locationInclude).toEqual(
      expect.objectContaining({
        as: 'location',
        required: true,
        where: {
          latitude: { [Op.not]: null },
          longitude: { [Op.not]: null }
        }
      })
    );
    expect(attendanceCategoryInclude).toEqual(
      expect.objectContaining({
        as: 'attendance_category',
        required: true,
        where: {
          category_name: {
            [Op.in]: expect.arrayContaining(['WFO', 'WFH', 'WFA'])
          }
        }
      })
    );
  });
});
