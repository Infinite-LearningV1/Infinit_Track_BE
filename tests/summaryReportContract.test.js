import { jest } from '@jest/globals';

const mockBuildSummaryReportSource = jest.fn();

jest.unstable_mockModule('../src/services/summaryReport.service.js', () => ({
  buildSummaryReportSource: mockBuildSummaryReportSource
}));

jest.unstable_mockModule('../src/utils/dashboardAnalytics.js', () => ({
  buildDashboardAnalytics: jest.fn()
}));

const { getSummaryReport } = await import('../src/controllers/summary.controller.js');

const buildRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis()
});

const buildSourceFixture = () => ({
  generated_at: '2026-06-29T01:00:00.000Z',
  period: 'monthly',
  date_range: {
    start_date: '2026-06-01',
    end_date: '2026-06-29'
  },
  summary: {
    total_ontime: 10,
    total_late: 2,
    total_early: 1,
    total_alpha: 1,
    total_wfo: 6,
    total_wfh: 4,
    total_wfa: 4
  },
  period_summary: {
    total_records: 14,
    attendance_rate: 87.5,
    average_discipline_score: 79.25,
    late_alpha_risk_users: 2,
    needs_attention_users: 1,
    status_distribution: {
      on_time: { count: 10, percentage: 71.43 },
      late: { count: 2, percentage: 14.29 },
      early: { count: 1, percentage: 7.14 },
      alpha: { count: 1, percentage: 7.14 }
    },
    work_mode_distribution: {
      wfo: { count: 6, percentage: 42.86 },
      wfh: { count: 4, percentage: 28.57 },
      wfa: { count: 4, percentage: 28.57 }
    },
    discipline_score_range: {
      excellent: { count: 1, percentage: 50, range: '85-100' },
      good: { count: 1, percentage: 50, range: '70-84.99' },
      needs_review: { count: 0, percentage: 0, range: '50-69.99' },
      attention: { count: 0, percentage: 0, range: '<50' }
    }
  },
  export_scope_summary: {
    scope: 'filtered_records_only',
    total_records: 2,
    attendance_rate: 100,
    average_discipline_score: 88
  },
  report: {
    data: [
      {
        attendance_id: 501,
        user_id: 101,
        full_name: 'Rina',
        role: 'User',
        nip_nim: 'NIP-101',
        email: 'rina@example.com',
        time_in: '08:00',
        time_out: '17:00',
        work_hour: '9h',
        attendance_date: '2026-06-10',
        location_details: {
          location_id: 3,
          description: 'Kantor Pusat',
          category: 'WFO',
          coordinates: { latitude: -0.9, longitude: 119.8 }
        },
        location_description: 'Kantor Pusat',
        work_category: 'WFO',
        status: 'Tepat Waktu',
        information: 'Work Duration: 9h',
        notes: '',
        discipline_score: 88,
        discipline_label: 'Sangat Baik',
        discipline_breakdown: { alpha_rate: 0 }
      }
    ],
    pagination: {
      current_page: 1,
      total_pages: 1,
      total_items: 1,
      items_per_page: 10,
      has_next_page: false,
      has_prev_page: false
    },
    user_attendance_summary: [
      {
        user_id: 101,
        full_name: 'Rina',
        role_name: 'User',
        division: 'Ops',
        expected_working_days: 10,
        on_time_days: 9,
        late_days: 1,
        early_days: 0,
        alpha_days: 0,
        wfo_days: 8,
        wfh_days: 1,
        wfa_days: 1,
        valid_attendance_days: 10,
        attendance_coverage_label: '10/10',
        latest_attendance_status: 'Tepat Waktu',
        latest_attendance_date: '2026-06-10',
        summary_note: 'Complete'
      }
    ]
  },
  analytics: {
    discipline_analysis: {
      users_analyzed: 1,
      average_discipline_score: 88,
      methodology: 'Fuzzy AHP Engine',
      criteria: ['Alpha Rate', 'Lateness Severity', 'Lateness Frequency', 'Work Focus']
    }
  },
  detailed_attendance_rows: [],
  discipline_insight_rows: [],
  metadata: {
    generated_by: 'Infinite Track System',
    timezone: 'Asia/Jakarta',
    title: 'Attendance Summary Report',
    data_source: 'Attendance Summary API',
    confidentiality: 'Confidential internal report'
  },
  message: 'Summary report with discipline analysis generated successfully'
});

describe('summary report controller contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildSummaryReportSource.mockResolvedValue(buildSourceFixture());
  });

  it('returns the canonical summary report contract with additive INF-183 summary fields', async () => {
    const req = {
      query: {
        period: 'monthly',
        q: 'Rina',
        page: '1',
        limit: '10'
      }
    };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReport(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockBuildSummaryReportSource).toHaveBeenCalledWith(req.query, {
      includePaginatedReport: true
    });
    expect(res.status).toHaveBeenCalledWith(200);

    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({
      success: true,
      generated_at: '2026-06-29T01:00:00.000Z',
      period: 'monthly',
      date_range: {
        start_date: '2026-06-01',
        end_date: '2026-06-29'
      },
      period_summary: {
        total_records: 14,
        attendance_rate: 87.5,
        average_discipline_score: 79.25
      },
      export_scope_summary: {
        scope: 'filtered_records_only',
        total_records: 2,
        attendance_rate: 100,
        average_discipline_score: 88
      }
    });
    expect(payload.report.data).toHaveLength(1);
    expect(payload.report.data[0]).toMatchObject({
      attendance_id: 501,
      user_id: 101,
      full_name: 'Rina',
      work_category: 'WFO',
      location_description: 'Kantor Pusat',
      status: 'Tepat Waktu',
      discipline_label: 'Sangat Baik'
    });
    expect(payload.report.data[0]).not.toHaveProperty('phone_number');
    expect(payload.report.user_attendance_summary).toHaveLength(1);
    expect(payload.report.user_attendance_summary[0]).toMatchObject({
      user_id: 101,
      full_name: 'Rina',
      summary_note: 'Complete'
    });
    expect(payload.report.user_attendance_summary[0]).not.toHaveProperty('discipline_label');
    expect(payload.period_summary.needs_attention_users).toBe(1);
    expect(payload.period_summary).not.toHaveProperty('needs_attention');
    expect(payload.report.pagination).toEqual({
      current_page: 1,
      total_pages: 1,
      total_items: 1,
      items_per_page: 10,
      has_next_page: false,
      has_prev_page: false
    });
  });

  it('returns validation payloads from the shared report source contract', async () => {
    const validationError = new Error(
      'Parameter period harus berupa: daily, weekly, monthly, range, 30d, current_month, atau custom'
    );
    validationError.code = 'E_VALIDATION';
    validationError.statusCode = 400;
    mockBuildSummaryReportSource.mockRejectedValueOnce(validationError);

    const req = { query: { period: 'all' } };
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
});
