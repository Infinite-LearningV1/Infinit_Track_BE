import { jest } from '@jest/globals';
import { Op } from 'sequelize';

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

const getDetailQueryOptions = () => mockAttendanceFindAndCountAll.mock.calls[0][0];
const getAnalyticsScopeQueryOptions = () => mockAttendanceFindAll.mock.calls[2][0];

const getSearchConditions = (whereClause) => {
  if (!whereClause || typeof whereClause !== 'object') {
    return undefined;
  }

  if (whereClause[Op.or]) {
    return whereClause[Op.or];
  }

  const andConditions = whereClause[Op.and];
  if (!Array.isArray(andConditions)) {
    return undefined;
  }

  for (const condition of andConditions) {
    const nestedSearch = getSearchConditions(condition);
    if (nestedSearch) {
      return nestedSearch;
    }
  }

  return undefined;
};

const expectSearchTerm = (queryOptions, expectedTerm) => {
  const searchConditions = getSearchConditions(queryOptions.where);

  expect(searchConditions).toEqual(expect.any(Array));
  expect(searchConditions).toEqual(
    expect.arrayContaining([
      { '$user.full_name$': { [Op.like]: `%${expectedTerm}%` } },
      { '$user.nip_nim$': { [Op.like]: `%${expectedTerm}%` } },
      { '$user.email$': { [Op.like]: `%${expectedTerm}%` } },
      { '$user.role.role_name$': { [Op.like]: `%${expectedTerm}%` } },
      { '$status.attendance_status_name$': { [Op.like]: `%${expectedTerm}%` } },
      { '$attendance_category.category_name$': { [Op.like]: `%${expectedTerm}%` } }
    ])
  );
};

const expectNoSearchConditions = (queryOptions) => {
  expect(getSearchConditions(queryOptions.where)).toBeUndefined();
};

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

const analyticsScopeSecondUserRow = {
  id_attendance: 502,
  user: {
    id_users: 202,
    full_name: 'Budi',
    email: 'budi@example.com',
    nip_nim: 'NIP-202',
    role: { role_name: 'Management' }
  },
  attendance_date: '2026-05-07'
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
    mockAttendanceFindAll.mockReset();
    mockAttendanceFindAndCountAll.mockReset();
    mockSettingsFindAll.mockReset();
    mockBuildUserAttendanceSummary.mockReset();
    mockCalculateDisciplineIndex.mockReset();
    mockGetDisciplineLabel.mockReset();

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
      .mockResolvedValueOnce([detailRow, analyticsScopeSecondUserRow])
      .mockResolvedValue([]);

    mockAttendanceFindAndCountAll.mockResolvedValueOnce({
      count: 1,
      rows: [detailRow]
    });

    mockSettingsFindAll.mockResolvedValueOnce([]);
    mockCalculateDisciplineIndex
      .mockResolvedValueOnce({
        score: 88,
        label: 'Sangat Baik',
        breakdown: { alpha_rate: 0 }
      })
      .mockResolvedValueOnce({
        score: 44,
        label: 'Cukup',
        breakdown: { alpha_rate: 50 }
      });
    mockGetDisciplineLabel.mockImplementation((score) => {
      if (score < 25) return 'Rendah';
      if (score < 50) return 'Cukup';
      if (score < 75) return 'Baik';
      return 'Sangat Baik';
    });
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

  it('rejects all report periods because unlimited dashboard summary reports are unsupported', async () => {
    const req = { query: { period: 'all', page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_VALIDATION',
      message: 'Parameter period harus berupa: daily, weekly, monthly, range, 30d, current_month, atau custom'
    });
  });

  it.each([
    ['daily'],
    ['weekly'],
    ['monthly'],
    ['range']
  ])('accepts canonical dashboard report period %s', async (period) => {
    const req = {
      query: {
        period,
        from: period === 'range' ? '2026-05-01' : undefined,
        to: period === 'range' ? '2026-05-07' : undefined,
        page: '1',
        limit: '10'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockAttendanceFindAndCountAll).toHaveBeenCalled();
  });

  it('rejects range report periods without both date boundaries', async () => {
    const req = { query: { period: 'range', from: '2026-05-01', page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_VALIDATION',
      message: 'Parameter from dan to wajib diisi saat period=range atau custom'
    });
  });

  it('rejects custom report periods without both date boundaries', async () => {
    const req = { query: { period: 'custom', from: '2026-05-01', page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_VALIDATION',
      message: 'Parameter from dan to wajib diisi saat period=range atau custom'
    });
  });

  it('applies canonical q search to report rows before pagination without filtering period-wide summary queries', async () => {
    const req = { query: { period: 'monthly', q: 'Rina', page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockAttendanceFindAll.mock.calls[0][0].where).toEqual({
      attendance_date: expect.any(Object)
    });
    expect(mockAttendanceFindAll.mock.calls[1][0].where).toEqual({
      attendance_date: expect.any(Object)
    });

    const queryOptions = getDetailQueryOptions();
    expect(queryOptions.distinct).toBe(true);
    expectSearchTerm(queryOptions, 'Rina');

    const payload = res.json.mock.calls[0][0];
    expect(payload.summary).toEqual({
      total_ontime: 1,
      total_late: 0,
      total_early: 0,
      total_alpha: 0,
      total_wfo: 1,
      total_wfh: 0,
      total_wfa: 0
    });
  });

  it('calculates discipline analytics from full-window rows scoped to visible report users', async () => {
    const req = { query: { period: 'monthly', q: 'Rina', page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();

    const detailQueryOptions = getDetailQueryOptions();
    expectSearchTerm(detailQueryOptions, 'Rina');

    const analyticsScopeQueryOptions = getAnalyticsScopeQueryOptions();
    const userIdOperator = Object.getOwnPropertySymbols(analyticsScopeQueryOptions.where.user_id).find(
      (symbol) => symbol.description === 'in'
    );
    expect(analyticsScopeQueryOptions.where.user_id[userIdOperator]).toEqual(['101']);
    const attendanceDateOperator = Object.getOwnPropertySymbols(
      analyticsScopeQueryOptions.where.attendance_date
    ).find((symbol) => symbol.description === 'between');
    expect(analyticsScopeQueryOptions.where.attendance_date[attendanceDateOperator]).toEqual([
      expect.any(String),
      expect.any(String)
    ]);
    expectNoSearchConditions(analyticsScopeQueryOptions);
    expect(analyticsScopeQueryOptions.limit).toBeUndefined();
    expect(analyticsScopeQueryOptions.offset).toBeUndefined();

    const payload = res.json.mock.calls[0][0];
    expect(payload.report.data).toHaveLength(1);
    expect(payload.report.data[0]).toMatchObject({
      attendance_id: 501,
      user_id: 101,
      full_name: 'Rina'
    });
    expect(payload.analytics.discipline_analysis).toMatchObject({
      users_analyzed: 1,
      average_discipline_score: 88
    });
  });

  it.each([
    ['search', 'SearchAlias'],
    ['query', 'QueryAlias'],
    ['keyword', 'KeywordAlias']
  ])('applies deprecated %s search alias when q is absent', async (paramName, value) => {
    const req = { query: { period: 'monthly', [paramName]: value, page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expectSearchTerm(getDetailQueryOptions(), value);
  });

  it('uses q over deprecated search aliases when multiple aliases are present', async () => {
    const req = {
      query: {
        period: 'monthly',
        q: 'Canonical',
        search: 'SearchAlias',
        query: 'QueryAlias',
        keyword: 'KeywordAlias',
        page: '1',
        limit: '10'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expectSearchTerm(getDetailQueryOptions(), 'Canonical');
  });

  it('treats blank q as no search filter', async () => {
    const req = { query: { period: 'monthly', q: '   ', page: '1', limit: '10' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    const queryOptions = getDetailQueryOptions();
    expectNoSearchConditions(queryOptions);
  });
});
