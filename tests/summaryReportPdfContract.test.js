import { jest } from '@jest/globals';

const mockBuildSummaryReportSource = jest.fn();

jest.unstable_mockModule('../src/services/summaryReport.service.js', () => ({
  buildSummaryReportSource: mockBuildSummaryReportSource
}));

jest.unstable_mockModule('../src/utils/dashboardAnalytics.js', () => ({
  buildDashboardAnalytics: jest.fn()
}));

const { getSummaryReportPdf } = await import('../src/controllers/summary.controller.js');

const buildRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis()
});

const sourceFixture = {
  generated_at: '2026-06-29T01:00:00.000Z',
  period: 'monthly',
  window: {
    period: 'monthly',
    timezone: 'Asia/Jakarta',
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
  },
  detailed_attendance_rows: [
    {
      attendance_id: 501,
      user_id: 101,
      full_name: 'Rina',
      nip_nim: 'NIP-101',
      role: 'User',
      attendance_date: '2026-06-10',
      time_in: '08:00',
      time_out: '17:00',
      work_hour: '9h',
      status: 'Tepat Waktu',
      work_category: 'WFO',
      discipline_score: 88,
      location_description: 'Kantor Pusat',
      report_insight: 'should not leak'
    }
  ],
  metadata: {
    generated_by: 'Infinite Track System',
    timezone: 'Asia/Jakarta',
    title: 'Attendance Summary Report',
    data_source: 'Attendance Summary API',
    confidentiality: 'Confidential internal report'
  }
};

describe('summary report pdf contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildSummaryReportSource.mockResolvedValue(sourceFixture);
  });

  it('projects the shared report source into the PDF-specific payload without report insight', async () => {
    const req = { query: { period: 'monthly', q: 'Rina' } };
    const res = buildRes();
    const next = jest.fn();

    await getSummaryReportPdf(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockBuildSummaryReportSource).toHaveBeenCalledWith(req.query, {
      includePaginatedReport: false
    });
    expect(res.status).toHaveBeenCalledWith(200);

    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({
      success: true,
      report_metadata: {
        title: 'Attendance Summary Report',
        generated_by: 'Infinite Track System',
        timezone: 'Asia/Jakarta'
      },
      window: sourceFixture.window,
      period_summary: sourceFixture.period_summary,
      export_scope_summary: sourceFixture.export_scope_summary,
      message: 'PDF report payload generated successfully'
    });
    expect(payload.detailed_attendance_table).toEqual([
      {
        attendance_id: 501,
        user_id: 101,
        full_name: 'Rina',
        nip_nim: 'NIP-101',
        role: 'User',
        attendance_date: '2026-06-10',
        time_in: '08:00',
        time_out: '17:00',
        work_hour: '9h',
        status: 'Tepat Waktu',
        work_category: 'WFO',
        discipline_score: 88,
        location_description: 'Kantor Pusat'
      }
    ]);
    expect(payload.detailed_attendance_table[0]).not.toHaveProperty('report_insight');
    expect(payload.detailed_attendance_table[0]).not.toHaveProperty('phone_number');
  });
});
