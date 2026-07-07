import {
  buildAttendanceReportFileName,
  renderMyAttendanceReportPdf
} from '../src/utils/pdfReportRenderer.js';

const payload = {
  report_metadata: {
    title: 'My Attendance Report',
    brand: 'Infinite Track',
    generated_at: '2026-07-07T00:00:00.000Z',
    generated_by: 'Infinite Track Backend',
    timezone: 'Asia/Jakarta',
    source_of_truth_notice: 'Generated from backend attendance records as the source of truth.'
  },
  user: {
    id: 42,
    full_name: 'Febri User',
    role: 'User',
    position: 'Engineer'
  },
  period: {
    type: 'monthly',
    display_label: 'Jul 2026',
    start_date: '2026-07-01',
    end_date: '2026-07-31'
  },
  summary: {
    attendance_rate_percent: null,
    attendance_rate_note: 'Unavailable: expected working day denominator is not verified for this report.',
    expected_working_days: null,
    attended_days: 1,
    total_work_hours: 8,
    late: 0,
    alpha: 0
  },
  mode_distribution: {
    wfo: { count: 1, included: true, label: 'WFO', percentage: 100 },
    wfa: { count: 0, included: true, label: 'WFA', percentage: 0 },
    wfh: { count: 0, included: false, label: 'WFH', percentage: null, note: 'Needs Verification: INF-164' }
  },
  timeline: [
    {
      attendance_date: '2026-07-01',
      mode_label: 'WFO',
      time_range: '08:00 - 17:00',
      work_hour: '08:00',
      status_label: 'On Time',
      location_label: 'Kantor Utama'
    }
  ],
  empty_state: { is_empty: false, message: null }
};

describe('personal attendance PDF renderer', () => {
  it('renders a PDF buffer with required report sections and no excluded product content', () => {
    const pdf = renderMyAttendanceReportPdf(payload);
    const text = pdf.toString('utf8');

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('Infinite Track');
    expect(text).toContain('My Attendance Report');
    expect(text).toContain('Report Summary');
    expect(text).toContain('Attendance Mode Distribution');
    expect(text).toContain('Attendance Timeline');
    expect(text).toContain('Generated from backend attendance records as the source of truth');
    expect(text).not.toContain('Personal Insight');
    expect(text).not.toContain('Smart Reminder');
    expect(text).not.toContain('Company Services');
  });

  it('builds the canonical monthly filename', () => {
    expect(buildAttendanceReportFileName(payload)).toBe('infinite-track-attendance-report-2026-07.pdf');
  });
});
