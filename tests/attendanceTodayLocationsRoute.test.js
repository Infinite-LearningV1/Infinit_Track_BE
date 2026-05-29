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

const mockTodayLocationsValidation = (req, res, next) => {
  const { limit } = req.query;

  if (limit == null || (/^[1-9]\d*$/.test(limit) && Number.parseInt(limit, 10) <= 500)) {
    return next();
  }

  return res.status(400).json({
    success: false,
    code: 'E_VALIDATION',
    message: 'limit must be a positive integer up to 500'
  });
};

const mockGetTodayLocations = jest.fn((req, res) => {
  res.status(200).json({
    success: true,
    data: {
      date: '2026-04-22',
      timezone: 'Asia/Jakarta',
      total_users: 0,
      locations: []
    },
    message: 'Today locations retrieved successfully'
  });
});

const mockDebugCheckInTime = jest.fn((req, res) => {
  res.status(200).json({
    success: true,
    message: 'Debug check-in time endpoint reached'
  });
});

jest.unstable_mockModule('../src/controllers/attendance.controller.js', () => ({
  getAttendanceHistory: jest.fn(),
  getAttendanceStatus: jest.fn(),
  checkIn: jest.fn(),
  checkOut: jest.fn(),
  debugCheckInTime: mockDebugCheckInTime,
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
  getTodayLocations: mockGetTodayLocations,
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
  todayLocationsValidation: [mockTodayLocationsValidation]
}));

const { default: attendanceRoutes } = await import('../src/routes/attendance.routes.js');

const app = express();
app.use(express.json());
app.use('/api/attendance', attendanceRoutes);

describe('attendance today locations route', () => {
  beforeEach(() => {
    authFails = false;
    allowRole = true;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 before RBAC or handler when authentication fails', async () => {
    authFails = true;

    const res = await request(app).get('/api/attendance/today-locations');

    expect(res.status).toBe(401);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockGetTodayLocations).not.toHaveBeenCalled();
  });

  it('runs auth verification before the handler', async () => {
    const res = await request(app).get('/api/attendance/today-locations');

    expect(res.status).toBe(200);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockGetTodayLocations).toHaveBeenCalled();
  });

  it('allows admin or management callers through to the handler', async () => {
    const res = await request(app).get('/api/attendance/today-locations');

    expect(res.status).toBe(200);
    expect(mockGetTodayLocations).toHaveBeenCalled();
  });

  it('returns 403 for non-admin non-management callers', async () => {
    allowRole = false;

    const res = await request(app).get('/api/attendance/today-locations');

    expect(res.status).toBe(403);
    expect(mockGetTodayLocations).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', 'abc', '100000'])(
    'returns 400 E_VALIDATION for invalid today-locations limit=%s',
    async (limit) => {
      const res = await request(app).get('/api/attendance/today-locations').query({ limit });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        success: false,
        code: 'E_VALIDATION'
      });
      expect(mockGetTodayLocations).not.toHaveBeenCalled();
    }
  );

  it('keeps debug check-in route restricted to admin or management callers', async () => {
    allowRole = false;

    const res = await request(app).get('/api/attendance/debug-checkin-time');

    expect(res.status).toBe(403);
    expect(mockDebugCheckInTime).not.toHaveBeenCalled();
  });
});
