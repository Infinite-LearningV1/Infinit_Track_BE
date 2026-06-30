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

const makeAttendanceRow = ({ id, userId, fullName, date, timeIn = '08:00', statusName = 'tepat waktu', workHour = 8 }) => ({
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

describe('summary report source runtime contract', () => {
  beforeEach(() => {
    jest.resetModules();
    mockAttendanceFindAll.mockReset();
    mockAttendanceFindAndCountAll.mockReset();
    mockSettingsFindAll.mockReset();
    mockBuildUserAttendanceSummary.mockReset();
    mockCalculateDisciplineIndex.mockReset();
    mockGetDisciplineLabel.mockReset();
  });

  test('derives discipline insight action codes from runtime summary inputs', async () => {
    const alphaUserRow = makeAttendanceRow({ id: 1, userId: 10, fullName: 'Alpha User', date: '2026-05-01' });
    const remindUserRow = makeAttendanceRow({ id: 2, userId: 11, fullName: 'Bravo User', date: '2026-05-01' });
    const monitorUserRow = makeAttendanceRow({ id: 3, userId: 12, fullName: 'Charlie User', date: '2026-05-01', statusName: 'terlambat', workHour: 7 });
    const noneUserRow = makeAttendanceRow({ id: 4, userId: 13, fullName: 'Delta User', date: '2026-05-01' });

    mockAttendanceFindAll
      .mockResolvedValueOnce([{ status: { attendance_status_name: 'tepat waktu' }, dataValues: { total: '4' } }])
      .mockResolvedValueOnce([{ attendance_category: { category_name: 'WFO' }, dataValues: { total: '4' } }])
      .mockResolvedValueOnce([alphaUserRow, remindUserRow, monitorUserRow, noneUserRow])
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
          time_in: new Date('2026-05-01T08:00:00'),
          time_out: new Date('2026-05-01T17:00:00'),
          work_hour: 8,
          status: { attendance_status_name: 'tepat waktu' }
        },
        {
          id_attendance: 3,
          user_id: 12,
          attendance_date: '2026-05-01',
          time_in: new Date('2026-05-01T09:00:00'),
          time_out: new Date('2026-05-01T17:00:00'),
          work_hour: 7,
          status: { attendance_status_name: 'terlambat' }
        },
        {
          id_attendance: 4,
          user_id: 13,
          attendance_date: '2026-05-01',
          time_in: new Date('2026-05-01T08:00:00'),
          time_out: new Date('2026-05-01T17:00:00'),
          work_hour: 8,
          status: { attendance_status_name: 'tepat waktu' }
        }
      ]);

    mockSettingsFindAll.mockResolvedValue([{ setting_key: 'checkin.start_time', setting_value: '08:00:00' }]);
    mockBuildUserAttendanceSummary.mockResolvedValue([
      {
        user_id: 10,
        full_name: 'Alpha User',
        division: 'Ops',
        expected_working_days: 1,
        valid_attendance_days: 1,
        late_days: 0,
        alpha_days: 1
      },
      {
        user_id: 11,
        full_name: 'Bravo User',
        division: 'Ops',
        expected_working_days: 1,
        valid_attendance_days: 1,
        late_days: 0,
        alpha_days: 0
      },
      {
        user_id: 12,
        full_name: 'Charlie User',
        division: 'Ops',
        expected_working_days: 1,
        valid_attendance_days: 1,
        late_days: 2,
        alpha_days: 0
      },
      {
        user_id: 13,
        full_name: 'Delta User',
        division: 'Ops',
        expected_working_days: 1,
        valid_attendance_days: 1,
        late_days: 0,
        alpha_days: 0
      }
    ]);

    mockCalculateDisciplineIndex
      .mockResolvedValueOnce({ score: 88, label: 'Excellent', breakdown: {} })
      .mockResolvedValueOnce({ score: 60, label: 'Needs Review', breakdown: {} })
      .mockResolvedValueOnce({ score: 78, label: 'Good', breakdown: {} })
      .mockResolvedValueOnce({ score: 92, label: 'Excellent', breakdown: {} });
    mockGetDisciplineLabel.mockReturnValue('Fallback');

    const { buildSummaryReportSource } = await import('../src/services/summaryReport.service.js');
    const payload = await buildSummaryReportSource({ period: '30d' }, { includePaginatedReport: false });

    expect(payload.discipline_insight_rows).toEqual([
      expect.objectContaining({ user_id: 10, employee_name: 'Alpha User', recommended_action_code: 'review' }),
      expect.objectContaining({ user_id: 11, employee_name: 'Bravo User', recommended_action_code: 'remind' }),
      expect.objectContaining({ user_id: 12, employee_name: 'Charlie User', recommended_action_code: 'monitor' }),
      expect.objectContaining({ user_id: 13, employee_name: 'Delta User', recommended_action_code: 'none' })
    ]);
    expect(mockCalculateDisciplineIndex).toHaveBeenCalledTimes(4);
  });
});
