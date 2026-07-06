import { jest } from '@jest/globals';

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const formatJakartaClock = (value) => {
  if (!value) return null;
  const shifted = new Date(new Date(value).getTime() + 7 * 60 * 60 * 1000);
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`;
};

const mockControllerDependencies = ({ findAllResults = [], findAndCountAllResult } = {}) => {
  const mockFindAll = jest.fn();
  for (const result of findAllResults) {
    mockFindAll.mockResolvedValueOnce(result);
  }
  mockFindAll.mockResolvedValue([]);

  const Attendance = {
    findAll: mockFindAll,
    findAndCountAll: jest.fn().mockResolvedValue(findAndCountAllResult || { count: 0, rows: [] })
  };

  jest.unstable_mockModule('../src/config/database.js', () => ({
    default: {
      fn: jest.fn((name, column) => ({ fn: name, column })),
      col: jest.fn((name) => ({ col: name })),
      transaction: jest.fn()
    }
  }));

  jest.unstable_mockModule('../src/models/index.js', () => ({
    Attendance,
    Booking: {},
    Location: {},
    Settings: {},
    AttendanceCategory: {},
    AttendanceStatus: {},
    BookingStatus: {},
    User: {},
    Role: {},
    LocationEvent: {},
    Photo: {}
  }));

  jest.unstable_mockModule('date-holidays', () => ({
    default: jest.fn().mockImplementation(() => ({ isHoliday: jest.fn(() => false) }))
  }));

  jest.unstable_mockModule('../src/utils/geofence.js', () => ({
    calculateDistance: jest.fn(),
    getJakartaTime: jest.fn(),
    getJakartaDateString: jest.fn(() => '2026-05-03'),
    getCurrentTimeForDB: jest.fn(),
    formatUTCToJakartaTime: jest.fn(formatJakartaClock)
  }));

  jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
    formatWorkHour: jest.fn((value) => {
      if (value == null || value <= 0) return '00:00';
      const hours = Math.floor(value);
      const minutes = Math.round((value - hours) * 60);
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }),
    calculateWorkHour: jest.fn((start, end) => {
      if (!start || !end) return 0;
      return Math.round(((new Date(end) - new Date(start)) / 36e5) * 100) / 100;
    }),
    formatTimeOnly: jest.fn(formatJakartaClock)
  }));

  jest.unstable_mockModule('../src/utils/searchHelper.js', () => ({
    applySearch: jest.fn()
  }));

  jest.unstable_mockModule('../src/utils/settings.js', () => ({
    getOperationalSettings: jest.fn()
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

  return { Attendance };
};

describe('getAttendanceHistory timeline contract', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('rejects invalid custom date input with 400 before querying attendance', async () => {
    const { Attendance } = mockControllerDependencies();
    const { getAttendanceHistory } = await import('../src/controllers/attendance.controller.js');

    const req = {
      user: { id: 42 },
      query: { period: 'custom', start_date: 'bad-date', end_date: '2026-05-31' }
    };
    const res = buildRes();

    await getAttendanceHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: expect.stringContaining('start_date')
      })
    );
    expect(Attendance.findAll).not.toHaveBeenCalled();
    expect(Attendance.findAndCountAll).not.toHaveBeenCalled();
  });

  it('returns additive timeline fields, custom period metadata, WFH summary, and active badge override', async () => {
    const activeAttendance = {
      id_attendance: 123,
      user_id: 42,
      category_id: 1,
      status_id: 1,
      attendance_date: '2026-05-03',
      time_in: new Date('2026-05-03T08:04:00+07:00'),
      time_out: null,
      work_hour: 5.53,
      notes: 'Manual attendance',
      attendance_category: { category_name: 'Work From Office' },
      status: { attendance_status_name: 'ontime' },
      location: { description: 'Kantor Utama' }
    };

    const { Attendance } = mockControllerDependencies({
      findAllResults: [
        [{ status_id: 1, count: '1' }],
        [
          { category_id: 1, count: '1' },
          { category_id: 2, count: '2' },
          { category_id: 3, count: '3' }
        ],
        [{ total_work_hours: '12.75' }]
      ],
      findAndCountAllResult: { count: 1, rows: [activeAttendance] }
    });
    const { getAttendanceHistory } = await import('../src/controllers/attendance.controller.js');

    const req = {
      user: { id: 42 },
      query: {
        period: 'custom',
        start_date: '2026-05-01',
        end_date: '2026-05-31',
        page: '1',
        limit: '20'
      }
    };
    const res = buildRes();

    await getAttendanceHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.data.period).toEqual({
      type: 'custom',
      label: 'Custom Range',
      start_date: '2026-05-01',
      end_date: '2026-05-31'
    });
    expect(body.data.summary).toEqual(
      expect.objectContaining({
        total_ontime: 1,
        total_wfo: 1,
        total_wfh: 2,
        total_wfa: 3,
        total_work_hours: 12.75
      })
    );
    expect(body.data.attendances[0]).toEqual(
      expect.objectContaining({
        id_attendance: 123,
        attendance_date: '2026-05-03',
        date_label: '03 May 2026',
        mode_key: 'wfo',
        mode_label: 'WFO',
        time_in: '08:04',
        time_out: null,
        time_range: '08:04 - --:--',
        status_key: 'ontime',
        status_label: 'On Time',
        display_badge_key: 'active',
        display_badge_label: 'Active Session',
        location_label: 'Kantor Utama',
        category: 'Work From Office',
        status: 'ontime',
        location: 'Kantor Utama'
      })
    );
    expect(Attendance.findAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 42,
          attendance_date: expect.any(Object)
        }),
        limit: 20,
        offset: 0
      })
    );
  });

  it('keeps alpha rows from displaying misleading work hours and uses final status badge', async () => {
    const alphaAttendance = {
      id_attendance: 321,
      user_id: 42,
      category_id: 1,
      status_id: 3,
      attendance_date: '2026-05-02',
      time_in: new Date('2026-05-02T00:00:00+07:00'),
      time_out: new Date('2026-05-03T07:00:00+07:00'),
      work_hour: 32,
      notes: 'Absent',
      attendance_category: { category_name: 'Work From Office' },
      status: { attendance_status_name: 'alpha' },
      location: null
    };

    mockControllerDependencies({
      findAllResults: [[{ status_id: 3, count: '1' }], [{ category_id: 1, count: '1' }], [{ total_work_hours: null }]],
      findAndCountAllResult: { count: 1, rows: [alphaAttendance] }
    });
    const { getAttendanceHistory } = await import('../src/controllers/attendance.controller.js');

    const req = { user: { id: 42 }, query: { period: 'monthly', page: '1', limit: '5' } };
    const res = buildRes();

    await getAttendanceHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const row = res.json.mock.calls[0][0].data.attendances[0];
    expect(row).toEqual(
      expect.objectContaining({
        status_key: 'alpha',
        status_label: 'Alpha',
        display_badge_key: 'alpha',
        display_badge_label: 'Alpha',
        work_hour: null,
        work_hour_raw: 32
      })
    );
  });
});
