import { jest } from '@jest/globals';

const mockAttendanceFindAll = jest.fn();
const mockAttendanceFindAndCountAll = jest.fn();
const mockSettingsFindAll = jest.fn();
const mockBuildUserAttendanceSummary = jest.fn();
const mockCalculateDisciplineIndex = jest.fn();
const mockGetDisciplineLabel = jest.fn();
const mockFormatWorkHour = jest.fn((value) => `${value}h`);
const mockFormatTimeOnly = jest.fn((value) => value);
const mockCalculateWorkHour = jest.fn(() => 8);

jest.unstable_mockModule('../src/config/database.js', () => ({
  default: {
    fn: jest.fn((name, column) => ({ fn: name, args: [column] })),
    col: jest.fn((name) => ({ col: name }))
  }
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
  Settings: { findAll: mockSettingsFindAll }
}));

jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
  formatWorkHour: mockFormatWorkHour,
  calculateWorkHour: mockCalculateWorkHour,
  formatTimeOnly: mockFormatTimeOnly
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() }
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

const { getSummaryReport } = await import('../src/controllers/summary.controller.js');

const buildRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis()
});

const detailRow = {
  id_attendance: 501,
  user: {
    id_users: 101,
    full_name: 'Rina',
    email: 'rina@example.com',
    nip_nim: 'NIP-101',
    role: { role_name: 'User' }
  },
  location: null,
  attendance_category: { category_name: 'WFO' },
  status: { attendance_status_name: 'Tepat Waktu' },
  time_in: '08:00:00',
  time_out: '17:00:00',
  work_hour: 9,
  attendance_date: '2026-05-07',
  notes: ''
};

const mockedSummaryRow = {
  user_id: 101,
  full_name: 'Rina',
  role_name: 'User',
  division: 'Ops',
  expected_working_days: 1,
  on_time_days: 1,
  late_days: 0,
  early_days: 0,
  alpha_days: 0,
  wfo_days: 1,
  wfh_days: 0,
  wfa_days: 0,
  valid_attendance_days: 1,
  attendance_coverage_label: '1/1',
  latest_attendance_status: 'Tepat Waktu',
  latest_attendance_date: '2026-05-07',
  summary_note: 'Complete'
};

describe('summary report controller contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockAttendanceFindAll
      .mockResolvedValueOnce([
        {
          status: { attendance_status_name: 'Tepat Waktu' },
          dataValues: { total: '1' }
        }
      ])
      .mockResolvedValueOnce([
        {
          attendance_category: { category_name: 'WFO' },
          dataValues: { total: '1' }
        }
      ])
      .mockResolvedValueOnce([]);

    mockAttendanceFindAndCountAll.mockResolvedValueOnce({
      count: 1,
      rows: [detailRow]
    });

    mockSettingsFindAll.mockResolvedValueOnce([]);
    mockCalculateDisciplineIndex.mockResolvedValueOnce({
      score: 88,
      label: 'Tinggi',
      breakdown: { alpha_rate: 0 }
    });
    mockGetDisciplineLabel.mockReturnValue('Sedang');
    mockBuildUserAttendanceSummary.mockResolvedValueOnce([mockedSummaryRow]);
  });

  it('returns generated_at and bounded user attendance summary for a custom dashboard-style report window without changing report data or pagination', async () => {
    const req = {
      query: {
        period: 'custom',
        from: '2026-05-01',
        to: '2026-05-07',
        page: '1',
        limit: '10'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockBuildUserAttendanceSummary).toHaveBeenCalledWith({
      startDate: '2026-05-01',
      endDate: '2026-05-07'
    });
    expect(res.status).toHaveBeenCalledWith(200);

    const payload = res.json.mock.calls[0][0];
    expect(payload.generated_at).toEqual(expect.any(String));
    expect(payload.period).toBe('custom');
    expect(payload.date_range).toEqual({
      start_date: '2026-05-01',
      end_date: '2026-05-07'
    });
    expect(payload.report.user_attendance_summary).toEqual([mockedSummaryRow]);
    expect(payload.report.data).toHaveLength(1);
    expect(payload.report.data[0]).toMatchObject({
      attendance_id: 501,
      user_id: 101,
      full_name: 'Rina',
      status: 'Tepat Waktu'
    });
    expect(payload.report.pagination).toEqual({
      current_page: 1,
      total_pages: 1,
      total_items: 1,
      items_per_page: 10,
      has_next_page: false,
      has_prev_page: false
    });
  });

  it('keeps /api/summary available when additive user attendance summary generation fails', async () => {
    mockBuildUserAttendanceSummary.mockReset();
    mockBuildUserAttendanceSummary.mockRejectedValueOnce(new Error('summary unavailable'));

    const req = { query: { period: '30d', page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);

    const payload = res.json.mock.calls[0][0];
    expect(payload.report.user_attendance_summary).toEqual([]);
    expect(payload.report.data).toHaveLength(1);
    expect(payload.report.pagination).toEqual({
      current_page: 1,
      total_pages: 1,
      total_items: 1,
      items_per_page: 10,
      has_next_page: false,
      has_prev_page: false
    });
  });

  it('rejects legacy report period values with the dashboard analytics period contract', async () => {
    const req = { query: { period: 'daily', page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockAttendanceFindAll).not.toHaveBeenCalled();
    expect(mockAttendanceFindAndCountAll).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_VALIDATION',
      message: 'Parameter period harus berupa: 30d, current_month, atau custom'
    });
  });

  it('rejects custom report periods without both date boundaries', async () => {
    const req = { query: { period: 'custom', from: '2026-05-01', page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockAttendanceFindAll).not.toHaveBeenCalled();
    expect(mockAttendanceFindAndCountAll).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_VALIDATION',
      message: 'Parameter from dan to wajib diisi saat period=custom'
    });
  });
});
