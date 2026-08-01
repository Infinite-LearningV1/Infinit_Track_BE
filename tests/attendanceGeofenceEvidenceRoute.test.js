import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

let authFails = false;
const mockVerifyToken = jest.fn((req, res, next) => {
  if (authFails) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  req.user = { id: 1, role_name: 'Admin' };
  return next();
});

let allowRole = true;
const mockRoleGuard = () => (_req, res, next) => {
  if (!allowRole) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
};

const mockDashboardAnalyticsValidation = (req, res, next) => {
  const { period = '30d', from = null, to = null } = req.query ?? {};

  if (period === 'custom' && (!from || !to)) {
    return res.status(400).json({
      success: false,
      code: 'E_VALIDATION',
      message: 'from and to are required when period is custom'
    });
  }

  return next();
};

const mockGetGeofenceEvidence = jest.fn((req, res) => {
  res.status(200).json({
    success: true,
    requested_window: {
      period: req.query.period ?? '30d',
      from: req.query.from ?? null,
      to: req.query.to ?? null
    },
    executed_window: {
      from: '2026-04-01',
      to: '2026-04-03'
    },
    data: {
      status: 'available',
      needs_data: false,
      reason: null,
      authority: 'context_only',
      final_attendance_authority: 'attendance_records',
      window: {
        from: '2026-04-01',
        to: '2026-04-03'
      },
      raw_counts: {
        total_events: 4,
        enter_events: 2,
        exit_events: 2,
        unique_users: 2
      },
      operational_context: {
        activity_label: 'Active',
        activity_note: '2 users generated 4 geofence events in this range.',
        enter_context: 'ENTER events support check-in reminder monitoring.',
        exit_context: 'EXIT events support active-session exit warning monitoring.',
        dashboard_note: 'Location context only. Final attendance validity remains determined by backend attendance records.'
      }
    },
    message: 'Geofence evidence retrieved successfully'
  });
});

jest.unstable_mockModule('../src/controllers/attendance.controller.js', () => ({
  getAttendanceHistory: jest.fn(),
  getAttendanceStatus: jest.fn(),
  checkIn: jest.fn(),
  checkOut: jest.fn(),
  debugCheckInTime: jest.fn(),
  deleteAttendance: jest.fn(),
  getAllAttendances: jest.fn(),
  getAttendanceDetail: jest.fn(),
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
  getGeofenceEvidence: mockGetGeofenceEvidence,
  previewMyAttendanceReportPdf: jest.fn(),
  exportMyAttendanceReportPdf: jest.fn(),
  testWeightedPrediction: jest.fn()
}));

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  __esModule: true,
  default: mockRoleGuard
}));

jest.unstable_mockModule('../src/middlewares/validator.js', () => ({
  upload: { single: jest.fn(() => (req, _res, next) => next()) },
  safeUrlField: jest.fn(() => []),
  registerValidation: [],
  loginValidation: [],
  validateLogin: [],
  validate: jest.fn((req, _res, next) => next()),
  validateFaceImage: jest.fn((req, _res, next) => next()),
  userRegistrationValidation: [],
  validateUpdateUser: [],
  validateCreateUser: [],
  checkInValidation: [],
  createBookingValidation: [],
  updateStatusValidation: [],
  checkOutValidation: [],
  locationEventValidation: [],
  todayLocationsValidation: [],
  dashboardAnalyticsValidation: [mockDashboardAnalyticsValidation]
}));

const { default: attendanceRoutes } = await import('../src/routes/attendance.routes.js');

const app = express();
app.use(express.json());
app.use('/api/attendance', attendanceRoutes);

describe('attendance geofence evidence route', () => {
  beforeEach(() => {
    authFails = false;
    allowRole = true;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 before RBAC or handler when authentication fails', async () => {
    authFails = true;

    const res = await request(app).get('/api/attendance/geofence-evidence');

    expect(res.status).toBe(401);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockGetGeofenceEvidence).not.toHaveBeenCalled();
  });

  it('returns 403 for non-admin non-management callers', async () => {
    allowRole = false;

    const res = await request(app).get('/api/attendance/geofence-evidence');

    expect(res.status).toBe(403);
    expect(mockGetGeofenceEvidence).not.toHaveBeenCalled();
  });

  it('serves geofence evidence through attendance ownership with historical window queries', async () => {
    const res = await request(app)
      .get('/api/attendance/geofence-evidence')
      .query({ period: 'custom', from: '2026-04-01', to: '2026-04-03' });

    expect(res.status).toBe(200);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockGetGeofenceEvidence).toHaveBeenCalled();
    expect(res.body).toMatchObject({
      success: true,
      requested_window: {
        period: 'custom',
        from: '2026-04-01',
        to: '2026-04-03'
      },
      executed_window: {
        from: '2026-04-01',
        to: '2026-04-03'
      },
      data: {
        authority: 'context_only',
        final_attendance_authority: 'attendance_records',
        raw_counts: {
          total_events: 4,
          enter_events: 2,
          exit_events: 2,
          unique_users: 2
        },
        operational_context: {
          activity_label: 'Active',
          activity_note: '2 users generated 4 geofence events in this range.',
          enter_context: 'ENTER events support check-in reminder monitoring.',
          exit_context: 'EXIT events support active-session exit warning monitoring.',
          dashboard_note: 'Location context only. Final attendance validity remains determined by backend attendance records.'
        }
      },
      message: 'Geofence evidence retrieved successfully'
    });
  });

  it('returns 400 E_VALIDATION for incomplete custom historical range', async () => {
    const res = await request(app)
      .get('/api/attendance/geofence-evidence')
      .query({ period: 'custom', from: '2026-04-01' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'E_VALIDATION'
    });
    expect(mockGetGeofenceEvidence).not.toHaveBeenCalled();
  });
});
