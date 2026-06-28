import { jest } from '@jest/globals';

const mockAttendanceFindAll = jest.fn();
const mockAttendanceFindAndCountAll = jest.fn();
const mockSettingsFindAll = jest.fn();
const mockBuildUserAttendanceSummary = jest.fn();
const mockCalculateDisciplineIndex = jest.fn();
const mockGetDisciplineLabel = jest.fn();

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {
    fn: (...args) => ({ fn: args }),
    col: (...args) => ({ col: args })
  }
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: { findAll: mockAttendanceFindAll, findAndCountAll: mockAttendanceFindAndCountAll },
  User: {},
  Role: {},
  Location: {},
  AttendanceCategory: {},
  AttendanceStatus: {},
  Settings: { findAll: mockSettingsFindAll }
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  default: {
    calculateDisciplineIndex: mockCalculateDisciplineIndex,
    getDisciplineLabel: mockGetDisciplineLabel
  }
}));

jest.unstable_mockModule('../src/utils/dashboardAnalytics.js', () => ({
  buildDashboardAnalytics: jest.fn()
}));

jest.unstable_mockModule('../src/utils/userAttendanceSummary.js', () => ({
  buildUserAttendanceSummary: mockBuildUserAttendanceSummary
}));

const makeRes = () => {
  const res = {
    status: jest.fn(() => res),
    json: jest.fn(() => res)
  };
  return res;
};

const makeAttendanceRow = ({ id, userId, fullName, date, timeIn, statusName = 'tepat waktu', workHour = 8 }) => ({
  id_attendance: id,
  user_id: userId,
  user: {
    id_users: userId,
    full_name: fullName,
    email: `${userId}@example.test`,
    nip_nim: `NIP-${userId}`,
    role: { role_name: 'User' }
  },
  location: null,
  attendance_category: { category_name: 'WFO' },
  status: { attendance_status_name: statusName },
  time_in: new Date(`${date}T${timeIn}:00`),
  time_out: new Date(`${date}T17:00:00`),
  work_hour: workHour,
  attendance_date: date,
  notes: ''
});

describe('getSummaryReport performance contract', () => {
  beforeEach(() => {
    jest.resetModules();
    mockAttendanceFindAll.mockReset();
    mockAttendanceFindAndCountAll.mockReset();
    mockSettingsFindAll.mockReset();
    mockBuildUserAttendanceSummary.mockReset();
    mockCalculateDisciplineIndex.mockReset();
    mockGetDisciplineLabel.mockReset();
  });

  test('fetches settings once and uses one scoped attendance fetch instead of per-user refetches', async () => {
    const userTenPageRow = makeAttendanceRow({
      id: 1,
      userId: 10,
      fullName: 'User Ten',
      date: '2026-05-01',
      timeIn: '08:00'
    });
    const userElevenPageRow = makeAttendanceRow({
      id: 2,
      userId: 11,
      fullName: 'User Eleven',
      date: '2026-05-01',
      timeIn: '09:30',
      statusName: 'terlambat',
      workHour: 7
    });

    mockAttendanceFindAll
      .mockResolvedValueOnce([{ status: { attendance_status_name: 'tepat waktu' }, dataValues: { total: '2' } }])
      .mockResolvedValueOnce([{ attendance_category: { category_name: 'WFO' }, dataValues: { total: '2' } }])
      .mockResolvedValueOnce([userTenPageRow, userElevenPageRow])
      .mockResolvedValueOnce([
        {
          id_attendance: 1,
          user_id: 10,
          attendance_date: '2026-05-01',
          time_in: new Date('2026-05-01T08:00:00'),
          time_out: new Date('2026-05-01T17:00:00'),
          work_hour: 8,
          status: { attendance_status_name: 'tepat waktu' }
        },
        {
          id_attendance: 2,
          user_id: 11,
          attendance_date: '2026-05-01',
          time_in: new Date('2026-05-01T09:30:00'),
          time_out: new Date('2026-05-01T17:00:00'),
          work_hour: 7,
          status: { attendance_status_name: 'terlambat' }
        }
      ]);
    mockAttendanceFindAndCountAll.mockResolvedValue({
      count: 2,
      rows: [userTenPageRow, userElevenPageRow]
    });
    mockSettingsFindAll.mockResolvedValue([{ setting_key: 'checkin.start_time', setting_value: '08:00:00' }]);
    mockBuildUserAttendanceSummary.mockResolvedValue([{ user_id: 10, total_attendance: 1 }]);
    mockCalculateDisciplineIndex.mockImplementation(async (metrics) => ({
      score: metrics.avg_lateness_minutes > 0 ? 70 : 95,
      label: metrics.avg_lateness_minutes > 0 ? 'Good' : 'Excellent',
      breakdown: { metrics }
    }));
    mockGetDisciplineLabel.mockReturnValue('Fallback');

    const { getSummaryReport } = await import('../src/controllers/summary.controller.js');
    const res = makeRes();

    await getSummaryReport(
      { query: { period: '30d', page: '1', limit: '10' } },
      res,
      jest.fn()
    );

    expect(mockSettingsFindAll).toHaveBeenCalledTimes(1);
    expect(mockAttendanceFindAndCountAll).toHaveBeenCalledTimes(1);
    expect(mockAttendanceFindAll).toHaveBeenCalledTimes(4);

    const scopedRowsWhere = mockAttendanceFindAll.mock.calls[2][0].where;
    const fullPeriodRowsWhere = mockAttendanceFindAll.mock.calls[3][0].where;
    const scopedAttendanceDateOperator = Object.getOwnPropertySymbols(scopedRowsWhere.attendance_date).find(
      (symbol) => symbol.description === 'between'
    );
    const fullPeriodAttendanceDateOperator = Object.getOwnPropertySymbols(fullPeriodRowsWhere.attendance_date).find(
      (symbol) => symbol.description === 'between'
    );

    expect(scopedRowsWhere.attendance_date[scopedAttendanceDateOperator]).toEqual([
      expect.any(String),
      expect.any(String)
    ]);
    expect(fullPeriodRowsWhere.attendance_date[fullPeriodAttendanceDateOperator]).toEqual([
      expect.any(String),
      expect.any(String)
    ]);
    expect(mockAttendanceFindAll.mock.calls[3][0].attributes).toEqual(
      expect.arrayContaining(['id_attendance', 'attendance_date', 'time_in', 'time_out', 'work_hour', 'user_id'])
    );
    expect(mockCalculateDisciplineIndex).toHaveBeenCalledTimes(2);

    const payload = res.json.mock.calls[0][0];
    expect(payload.report.user_attendance_summary).toEqual([{ user_id: 10, total_attendance: 1 }]);
    expect(payload.report.data).toHaveLength(2);
    expect(payload.report.data[0]).toEqual(
      expect.objectContaining({
        user_id: 10,
        discipline_score: 95,
        discipline_label: 'Excellent'
      })
    );
    expect(payload.report.data[1]).toEqual(
      expect.objectContaining({
        user_id: 11,
        discipline_score: 70,
        discipline_label: 'Good'
      })
    );
  });

  test('calculates discipline metrics from full-window scoped rows instead of only page rows', async () => {
    const pageRow = makeAttendanceRow({
      id: 1,
      userId: 10,
      fullName: 'User Ten',
      date: '2026-05-02',
      timeIn: '08:00'
    });
    const lateOffPageRow = makeAttendanceRow({
      id: 2,
      userId: 10,
      fullName: 'User Ten',
      date: '2026-05-01',
      timeIn: '09:00',
      statusName: 'terlambat',
      workHour: 7
    });
    const alphaOffPageRow = makeAttendanceRow({
      id: 3,
      userId: 10,
      fullName: 'User Ten',
      date: '2026-04-30',
      timeIn: '08:00',
      statusName: 'alpha',
      workHour: 0
    });

    mockAttendanceFindAll
      .mockResolvedValueOnce([{ status: { attendance_status_name: 'tepat waktu' }, dataValues: { total: '1' } }])
      .mockResolvedValueOnce([{ attendance_category: { category_name: 'WFO' }, dataValues: { total: '1' } }])
      .mockResolvedValueOnce([pageRow, lateOffPageRow, alphaOffPageRow])
      .mockResolvedValueOnce([
        {
          id_attendance: 1,
          user_id: 10,
          attendance_date: '2026-05-02',
          time_in: new Date('2026-05-02T08:00:00'),
          time_out: new Date('2026-05-02T17:00:00'),
          work_hour: 8,
          status: { attendance_status_name: 'tepat waktu' }
        },
        {
          id_attendance: 2,
          user_id: 10,
          attendance_date: '2026-05-01',
          time_in: new Date('2026-05-01T09:00:00'),
          time_out: new Date('2026-05-01T17:00:00'),
          work_hour: 7,
          status: { attendance_status_name: 'terlambat' }
        },
        {
          id_attendance: 3,
          user_id: 10,
          attendance_date: '2026-04-30',
          time_in: new Date('2026-04-30T08:00:00'),
          time_out: new Date('2026-04-30T08:00:00'),
          work_hour: 0,
          status: { attendance_status_name: 'alpha' }
        }
      ]);
    mockAttendanceFindAndCountAll.mockResolvedValue({ count: 3, rows: [pageRow] });
    mockSettingsFindAll.mockResolvedValue([{ setting_key: 'checkin.start_time', setting_value: '08:00:00' }]);
    mockBuildUserAttendanceSummary.mockResolvedValue([]);
    mockCalculateDisciplineIndex.mockImplementation(async (metrics) => ({
      score: metrics.alpha_rate > 0 && metrics.avg_lateness_minutes > 0 ? 60 : 95,
      label: metrics.alpha_rate > 0 && metrics.avg_lateness_minutes > 0 ? 'Needs Attention' : 'Excellent',
      breakdown: { metrics }
    }));
    mockGetDisciplineLabel.mockReturnValue('Fallback');

    const { getSummaryReport } = await import('../src/controllers/summary.controller.js');
    const res = makeRes();

    await getSummaryReport(
      { query: { period: '30d', page: '1', limit: '1' } },
      res,
      jest.fn()
    );

    expect(mockAttendanceFindAll).toHaveBeenCalledTimes(4);
    const fullPeriodRowsWhere = mockAttendanceFindAll.mock.calls[3][0].where;
    const attendanceDateOperator = Object.getOwnPropertySymbols(fullPeriodRowsWhere.attendance_date).find(
      (symbol) => symbol.description === 'between'
    );
    expect(fullPeriodRowsWhere.attendance_date[attendanceDateOperator]).toEqual([
      expect.any(String),
      expect.any(String)
    ]);
    expect(mockCalculateDisciplineIndex).toHaveBeenCalledTimes(1);
    expect(mockCalculateDisciplineIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        total_days: 3,
        alpha_days: 1,
        late_days: 1,
        alpha_rate: 33.33,
        lateness_frequency: 50,
        avg_lateness_minutes: 30,
        work_hour_consistency: 50
      })
    );

    const payload = res.json.mock.calls[0][0];
    expect(payload.report.data).toHaveLength(1);
    expect(payload.report.data[0]).toEqual(
      expect.objectContaining({
        user_id: 10,
        discipline_score: 60,
        discipline_label: 'Needs Attention'
      })
    );
  });
});
