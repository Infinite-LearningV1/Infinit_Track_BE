import { buildDashboardAnalytics } from '../utils/dashboardAnalytics.js';
import { buildSummaryReportSource } from '../services/summaryReport.service.js';

const buildValidationErrorResponse = (res, error) => {
  return res.status(error.statusCode || 400).json({
    success: false,
    code: error.code || 'E_VALIDATION',
    message: error.message
  });
};

const toTitleCase = (value) => {
  return String(value || '')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

const buildPdfMetadata = (source) => ({
  title: source.metadata.title,
  period_label: toTitleCase(source.period),
  generated_on: source.generated_at,
  generated_by: source.metadata.generated_by,
  data_source: source.metadata.data_source,
  confidentiality: source.metadata.confidentiality,
  timezone: source.metadata.timezone
});

const buildExcelFileName = (source) => {
  return `Infinite Track_Attendance_Report_${source.window.start_date}_${source.window.end_date}.xlsx`;
};

const buildWorkbookMetadata = (source) => ({
  file_name: buildExcelFileName(source),
  generated_on: source.generated_at,
  generated_by: source.metadata.generated_by,
  timezone: source.metadata.timezone
});

const projectPdfRows = (rows) => {
  return rows.map((row) => ({
    attendance_id: row.attendance_id,
    user_id: row.user_id,
    full_name: row.full_name,
    nip_nim: row.nip_nim,
    role: row.role,
    attendance_date: row.attendance_date,
    time_in: row.time_in,
    time_out: row.time_out,
    work_hour: row.work_hour,
    status: row.status,
    work_category: row.work_category,
    discipline_score: row.discipline_score,
    location_description: row.location_description
  }));
};

const projectExcelAttendanceRows = (rows) => {
  return rows.map((row) => ({
    attendance_id: row.attendance_id,
    user_id: row.user_id,
    full_name: row.full_name,
    nip_nim: row.nip_nim,
    role: row.role,
    email: row.email,
    attendance_date: row.attendance_date,
    time_in: row.time_in,
    time_out: row.time_out,
    work_hour: row.work_hour,
    status: row.status,
    work_category: row.work_category,
    information: row.information,
    notes: row.notes,
    discipline_score: row.discipline_score,
    discipline_label: row.discipline_label,
    location_description: row.location_description
  }));
};

export const getSummaryReport = async (req, res, next) => {
  try {
    const source = await buildSummaryReportSource(req.query, { includePaginatedReport: true });

    return res.status(200).json({
      success: true,
      generated_at: source.generated_at,
      summary: source.summary,
      period_summary: source.period_summary,
      export_scope_summary: source.export_scope_summary,
      report: source.report,
      analytics: source.analytics,
      period: source.period,
      date_range: source.date_range,
      message: source.message
    });
  } catch (error) {
    if (error.code === 'E_VALIDATION') {
      return buildValidationErrorResponse(res, error);
    }

    return next(error);
  }
};

export const getSummaryReportPdf = async (req, res, next) => {
  try {
    const source = await buildSummaryReportSource(req.query, { includePaginatedReport: false });

    return res.status(200).json({
      success: true,
      generated_at: source.generated_at,
      report_metadata: buildPdfMetadata(source),
      window: source.window,
      period_summary: source.period_summary,
      export_scope_summary: source.export_scope_summary,
      detailed_attendance_table: projectPdfRows(source.detailed_attendance_rows),
      message: 'PDF report payload generated successfully'
    });
  } catch (error) {
    if (error.code === 'E_VALIDATION') {
      return buildValidationErrorResponse(res, error);
    }

    return next(error);
  }
};

export const getSummaryReportExcel = async (req, res, next) => {
  try {
    const source = await buildSummaryReportSource(req.query, { includePaginatedReport: false });

    return res.status(200).json({
      success: true,
      generated_at: source.generated_at,
      workbook_metadata: buildWorkbookMetadata(source),
      window: source.window,
      summary_sheet: {
        period_summary: source.period_summary,
        export_scope_summary: source.export_scope_summary
      },
      attendance_report_sheet: projectExcelAttendanceRows(source.detailed_attendance_rows),
      discipline_insight_sheet: source.discipline_insight_rows,
      message: 'Excel workbook payload generated successfully'
    });
  } catch (error) {
    if (error.code === 'E_VALIDATION') {
      return buildValidationErrorResponse(res, error);
    }

    return next(error);
  }
};

export const getDashboardAnalytics = async (req, res, next) => {
  try {
    const { period = '30d', from = null, to = null } = req.query;
    const data = await buildDashboardAnalytics({ period, from, to });

    return res.status(200).json({
      success: true,
      requested_window: data.meta?.requested_window ?? null,
      executed_window: data.meta?.executed_window ?? null,
      data,
      message: 'Dashboard analytics retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

export default {
  getSummaryReport,
  getSummaryReportPdf,
  getSummaryReportExcel,
  getDashboardAnalytics
};
