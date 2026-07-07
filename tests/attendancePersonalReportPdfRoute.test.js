import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

let authFails = false;
const mockVerifyToken = jest.fn((req, res, next) => {
  if (authFails) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  req.user = { id: 42, role_name: 'User' };
  return next();
});

const mockPreviewMyAttendanceReportPdf = jest.fn((_req, res) => {
  res.status(200).setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="infinite-track-attendance-report-2026-07.pdf"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from('%PDF-1.4 preview'));
});

const mockExportMyAttendanceReportPdf = jest.fn((_req, res) => {
  res.status(200).setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="infinite-track-attendance-report-2026-07.pdf"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from('%PDF-1.4 export'));
});

jest.unstable_mockModule('../src/controllers/attendance.controller.js', () => ({
  getAttendanceHistory: jest.fn(),
  getAttendanceStatus: jest.fn(),
  checkIn: jest.fn(),
  checkOut: jest.fn(),
  debugCheckInTime: jest.fn(),
  deleteAttendance: jest.fn(),
  getAllAttendances: jest.fn(),
  manualAutoCheckout: jest.fn(),
  getAutoCheckoutSettings: jest.fn(),
  manualResolveWfaBookings: jest.fn(),
  manualGeneralAlphaForDate: jest.fn(),
  manualResolveWfaForDate: jest.fn(),
  manualSmartAutoCheckoutForDate: jest.fn(),
  logLocationEvent: jest.fn(),
  getSmartEngineConfig: jest.fn(),
  getEnhancedAutoCheckoutSettings: jest.fn(),
  getTodayLocations: jest.fn(),
  getGeofenceEvidence: jest.fn(),
  previewMyAttendanceReportPdf: mockPreviewMyAttendanceReportPdf,
  exportMyAttendanceReportPdf: mockExportMyAttendanceReportPdf,
  testWeightedPrediction: jest.fn()
}));

jest.unstable_mockModule('../src/controllers/researchAttendance.controller.js', () => ({
  triggerResearchAttendanceDaily: jest.fn(),
  triggerResearchAttendanceFullDay: jest.fn()
}));

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  __esModule: true,
  default: () => (_req, _res, next) => next()
}));

jest.unstable_mockModule('../src/middlewares/validator.js', () => ({
  checkInValidation: [],
  checkOutValidation: [],
  validate: (_req, _res, next) => next(),
  locationEventValidation: [],
  todayLocationsValidation: [],
  dashboardAnalyticsValidation: []
}));

const { default: attendanceRoutes } = await import('../src/routes/attendance.routes.js');

const app = express();
app.use('/api/attendance', attendanceRoutes);

describe('personal attendance PDF routes', () => {
  beforeEach(() => {
    authFails = false;
    jest.clearAllMocks();
  });

  it.each(['/api/attendance/history/personal/pdf', '/api/attendance/history/export.pdf'])(
    'requires authentication for %s',
    async (path) => {
      authFails = true;

      const res = await request(app).get(path);

      expect(res.status).toBe(401);
      expect(mockVerifyToken).toHaveBeenCalled();
      expect(mockPreviewMyAttendanceReportPdf).not.toHaveBeenCalled();
      expect(mockExportMyAttendanceReportPdf).not.toHaveBeenCalled();
    }
  );

  it('routes preview PDF requests to the inline handler', async () => {
    const res = await request(app).get('/api/attendance/history/personal/pdf?period=monthly');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('inline');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(mockPreviewMyAttendanceReportPdf).toHaveBeenCalled();
  });

  it('routes export PDF requests to the attachment handler', async () => {
    const res = await request(app).get('/api/attendance/history/export.pdf?period=monthly');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(mockExportMyAttendanceReportPdf).toHaveBeenCalled();
  });
});
