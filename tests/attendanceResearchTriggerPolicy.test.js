import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

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
  previewMyAttendanceReportPdf: jest.fn(),
  exportMyAttendanceReportPdf: jest.fn(),
  testWeightedPrediction: jest.fn()
}));

let featureEnabled = false;

jest.unstable_mockModule('../src/config/index.js', () => ({
  __esModule: true,
  default: {
    get researchAttendanceTriggerEnabled() {
      return featureEnabled;
    }
  }
}));

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: jest.fn((req, _res, next) => {
    req.user = { id: 1, role_name: 'Admin' };
    next();
  })
}));

jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  __esModule: true,
  default: jest.fn(() => (_req, _res, next) => next())
}));

jest.unstable_mockModule('../src/middlewares/validator.js', () => ({
  checkInValidation: [],
  checkOutValidation: [],
  validate: jest.fn((_req, _res, next) => next()),
  locationEventValidation: [],
  todayLocationsValidation: [],
  dashboardAnalyticsValidation: []
}));

const { default: attendanceRoutes } = await import('../src/routes/attendance.routes.js');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/attendance', attendanceRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({
      success: false,
      code: err.code || 'E_INTERNAL',
      message: err.message
    });
  });
  return app;
};

describe('attendance research trigger policy guardrails', () => {
  beforeEach(() => {
    featureEnabled = false;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('rejects the daily trigger when the feature flag is disabled', async () => {
    const app = buildApp();

    const res = await request(app).post('/api/attendance/research-trigger/daily').send({
      target_date: '2026-07-01'
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      success: false,
      code: 'E_FEATURE_DISABLED'
    });
  });

  it('rejects the full-day trigger when target_date is missing', async () => {
    featureEnabled = true;
    const app = buildApp();

    const res = await request(app).post('/api/attendance/research-trigger/full-day').send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'E_TARGET_DATE_REQUIRED'
    });
  });

  it('rejects apply mode when confirm is missing', async () => {
    featureEnabled = true;
    const app = buildApp();

    const res = await request(app).post('/api/attendance/research-trigger/daily').send({
      target_date: '2026-07-01',
      dry_run: false
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'E_CONFIRMATION_REQUIRED'
    });
  });
});
