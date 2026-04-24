import { jest } from '@jest/globals';

const mockSettingsFindAll = jest.fn();
const mockAttendanceFindAll = jest.fn();
const mockAttendanceFindAndCountAll = jest.fn();
const mockFuzzyCalculate = jest.fn(async () => ({
  score: 88,
  label: 'Sangat Tinggi',
  breakdown: {}
}));

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: { fn: jest.fn(), col: jest.fn() }
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: {
    findAll: mockAttendanceFindAll,
    findAndCountAll: mockAttendanceFindAndCountAll
  },
  User: {},
  Role: {},
  Location: {},
  AttendanceCategory: {},
  AttendanceStatus: {},
  Settings: {
    findAll: mockSettingsFindAll
  }
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
  formatWorkHour: jest.fn(() => '8h 0m'),
  formatTimeOnly: jest.fn(() => '08:15'),
  calculateWorkHour: jest.fn(() => 8)
}));

jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  default: {
    calculateDisciplineIndex: mockFuzzyCalculate,
    getDisciplineLabel: jest.fn(() => 'Sedang')
  }
}));

const buildRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis()
});

describe('summary settings cache', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSettingsFindAll.mockReset();
    mockAttendanceFindAll.mockReset();
    mockAttendanceFindAndCountAll.mockReset();
    mockFuzzyCalculate.mockClear();
  });

  test('loads checkin.start_time once for a summary request with multiple unique users', async () => {
    mockSettingsFindAll.mockResolvedValue([
      { setting_key: 'checkin.start_time', setting_value: '08:00:00' }
    ]);

    mockAttendanceFindAndCountAll.mockResolvedValue({
      count: 2,
      rows: [
        {
          id_attendance: 101,
          attendance_date: '2026-04-23',
          time_in: new Date('2026-04-23T01:15:00.000Z'),
          time_out: new Date('2026-04-23T10:00:00.000Z'),
          work_hour: 8,
          notes: '',
          user: {
            id_users: 7,
            full_name: 'Febri',
            email: 'f@example.com',
            nip_nim: '001',
            role: { role_name: 'User' }
          },
          location: null,
          attendance_category: { category_name: 'WFO' },
          status: { attendance_status_name: 'Tepat Waktu' }
        },
        {
          id_attendance: 102,
          attendance_date: '2026-04-23',
          time_in: new Date('2026-04-23T01:20:00.000Z'),
          time_out: new Date('2026-04-23T10:00:00.000Z'),
          work_hour: 8,
          notes: '',
          user: {
            id_users: 8,
            full_name: 'Diana',
            email: 'd@example.com',
            nip_nim: '002',
            role: { role_name: 'User' }
          },
          location: null,
          attendance_category: { category_name: 'WFH' },
          status: { attendance_status_name: 'Terlambat' }
        }
      ]
    });

    mockAttendanceFindAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          time_in: new Date('2026-04-23T01:15:00.000Z'),
          work_hour: 8,
          status: { attendance_status_name: 'Tepat Waktu' }
        }
      ])
      .mockResolvedValueOnce([
        {
          time_in: new Date('2026-04-23T01:20:00.000Z'),
          work_hour: 8,
          status: { attendance_status_name: 'Terlambat' }
        }
      ]);

    const { getSummaryReport } = await import('../src/controllers/summary.controller.js');

    const req = { query: { period: 'daily', page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSettingsFindAll).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
