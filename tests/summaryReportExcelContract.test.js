import { jest } from '@jest/globals';

const buildValidationError = () => {
  const error = new Error(
    'Parameter period harus berupa: daily, weekly, monthly, range, 30d, current_month, atau custom'
  );
  error.code = 'E_VALIDATION';
  error.statusCode = 400;
  return error;
};

const mockBuildSummaryReportSource = jest.fn();

jest.unstable_mockModule('../src/services/summaryReport.service.js', () => ({
  buildSummaryReportSource: mockBuildSummaryReportSource
}));

jest.unstable_mockModule('../src/utils/dashboardAnalytics.js', () => ({
  buildDashboardAnalytics: jest.fn()
}));

const { getSummaryReportExcel } = await import('../src/controllers/summary.controller.js');

const buildRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis()
});

const sourceFixture = {
  generated_at: '2026-06-29T01:00:00.000Z',
  window: {
    period: 'monthly',
    timezone: 'Asia/Jakarta',
    start_date: '2026-06-01',
    end_date: '2026-06-29'
  },
  period_summary: {
    total_records: 14,
    attendance_rate: 87.5,
    average_discipline_score: 79.25,
    needs_attention_users: 1
  },
  export_scope_summary: {
    scope: 'filtered_records_only',
    total_records: 2,
    attendance_rate: 100,
    average_discipline_score: 88
  },
  detailed_attendance_rows: [
    {
      attendance_id: 501,
      user_id: 101,
      full_name: 'Rina',
      nip_nim: 'NIP-101',
      role: 'User',
      email: 'rina@example.com',
      attendance_date: '2026-06-10',
      time_in: '08:00',
      time_out: '17:00',
      work_hour: '9h',
      status: 'Tepat Waktu',
      work_category: 'WFO',
      information: 'Work Duration: 9h',
      notes: '',
      discipline_score: 88,
      discipline_label: 'Sangat Baik',
      location_description: 'Kantor Pusat'
    }
  ],
  discipline_insight_rows: [
    {
      user_id: 101,
      employee_name: 'Rina',
      division: 'Ops',
      attendance_rate: 100,
      late_count: 0,
      alpha_count: 0,
      avg_discipline_score: 88,
      discipline_label: 'Sangat Baik',
      recommended_action_code: 'review'
    }
  ],
  metadata: {
    generated_by: 'Infinite Track System',
    timezone: 'Asia/Jakarta'
  }
};

describe('summary report excel contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildSummaryReportSource.mockResolvedValue(sourceFixture);
  });

  it('projects the shared report source into workbook-oriented sections while preserving runtime-calculated action codes', async () => {
    const req = { query: { period: 'monthly', q: 'Rina' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReportExcel(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockBuildSummaryReportSource).toHaveBeenCalledWith(req.query, {
      includePaginatedReport: false
    });
    expect(res.status).toHaveBeenCalledWith(200);

    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({
      success: true,
      workbook_metadata: {
        generated_by: 'Infinite Track System',
        timezone: 'Asia/Jakarta'
      },
      window: sourceFixture.window,
      summary_sheet: {
        period_summary: sourceFixture.period_summary,
        export_scope_summary: sourceFixture.export_scope_summary
      },
      message: 'Excel workbook payload generated successfully'
    });
    expect(payload.workbook_metadata.file_name).toContain('Infinite Track_Attendance_Report_');
    expect(payload.attendance_report_sheet[0]).toMatchObject({
      attendance_id: 501,
      email: 'rina@example.com',
      work_category: 'WFO',
      location_description: 'Kantor Pusat',
      discipline_label: 'Sangat Baik'
    });
    expect(payload.attendance_report_sheet[0]).not.toHaveProperty('phone_number');
    expect(payload.summary_sheet.period_summary.needs_attention_users).toBe(1);
    expect(payload.discipline_insight_sheet).toEqual([
      {
        user_id: 101,
        employee_name: 'Rina',
        division: 'Ops',
        attendance_rate: 100,
        late_count: 0,
        alpha_count: 0,
        avg_discipline_score: 88,
        discipline_label: 'Sangat Baik',
        recommended_action_code: 'review'
      }
    ]);
  });

  it('returns validation payloads from the shared report source contract', async () => {
    mockBuildSummaryReportSource.mockRejectedValueOnce(buildValidationError());

    const req = { query: { period: 'all' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReportExcel(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_VALIDATION',
      message: 'Parameter period harus berupa: daily, weekly, monthly, range, 30d, current_month, atau custom'
    });
  });
});
