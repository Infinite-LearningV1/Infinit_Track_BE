import { jest } from '@jest/globals';

const mockBuildPersonalAttendanceReportPayload = jest.fn();
const mockRenderMyAttendanceReportPdf = jest.fn();
const mockBuildAttendanceReportFileName = jest.fn();

jest.unstable_mockModule('../src/services/attendanceReport.service.js', () => ({
  buildPersonalAttendanceReportPayload: mockBuildPersonalAttendanceReportPayload
}));

jest.unstable_mockModule('../src/utils/pdfReportRenderer.js', () => ({
  buildAttendanceReportFileName: mockBuildAttendanceReportFileName,
  renderMyAttendanceReportPdf: mockRenderMyAttendanceReportPdf
}));

const { previewMyAttendanceReportPdf, exportMyAttendanceReportPdf } = await import(
  '../src/controllers/attendance.controller.js'
);

const buildRes = () => ({
  status: jest.fn().mockReturnThis(),
  setHeader: jest.fn().mockReturnThis(),
  send: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis()
});

const reportPayload = {
  report_metadata: { generated_at: '2026-07-07T00:00:00.000Z' },
  period: { start_date: '2026-07-01' },
  user: { id: 42, full_name: 'Febri User' },
  summary: {},
  mode_distribution: {},
  timeline: []
};

describe('personal attendance PDF controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildPersonalAttendanceReportPayload.mockResolvedValue(reportPayload);
    mockRenderMyAttendanceReportPdf.mockReturnValue(Buffer.from('%PDF-1.4\ncontroller-test'));
    mockBuildAttendanceReportFileName.mockReturnValue('infinite-track-attendance-report-2026-07.pdf');
  });

  it('sends preview PDF inline, no-store, and scopes payload to req.user.id', async () => {
    const req = { user: { id: 42 }, query: { period: 'monthly', user_id: '999' } };
    const res = buildRes();

    await previewMyAttendanceReportPdf(req, res);

    expect(mockBuildPersonalAttendanceReportPayload).toHaveBeenCalledWith({
      userId: 42,
      query: { period: 'monthly' }
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'inline; filename="infinite-track-attendance-report-2026-07.pdf"'
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
  });

  it('sends export PDF as attachment using the same shared service and renderer', async () => {
    const req = { user: { id: 42 }, query: { period: 'monthly' } };
    const res = buildRes();

    await exportMyAttendanceReportPdf(req, res);

    expect(mockBuildPersonalAttendanceReportPayload).toHaveBeenCalledWith({
      userId: 42,
      query: { period: 'monthly' }
    });
    expect(mockRenderMyAttendanceReportPdf).toHaveBeenCalledWith(reportPayload);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="infinite-track-attendance-report-2026-07.pdf"'
    );
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('returns validation error payloads without rendering PDF', async () => {
    const error = new Error('Invalid custom date');
    error.code = 'E_VALIDATION';
    error.statusCode = 400;
    mockBuildPersonalAttendanceReportPayload.mockRejectedValueOnce(error);
    const req = { user: { id: 42 }, query: { period: 'custom', start_date: 'bad-date' } };
    const res = buildRes();

    await exportMyAttendanceReportPdf(req, res);

    expect(mockRenderMyAttendanceReportPdf).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_VALIDATION',
      message: 'Invalid custom date'
    });
  });
});
