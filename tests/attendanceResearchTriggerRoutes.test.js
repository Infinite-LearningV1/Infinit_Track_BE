import { jest } from '@jest/globals';

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

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: jest.fn((_req, _res, next) => next())
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

const getMountedPostPaths = (router) =>
  router.stack
    .filter((layer) => layer.route && layer.route.methods?.post)
    .map((layer) => layer.route.path);

describe('attendance research trigger route contract', () => {
  it('mounts the daily research trigger endpoint under the attendance router', () => {
    const postPaths = getMountedPostPaths(attendanceRoutes);

    expect(postPaths).toContain('/research-trigger/daily');
  });

  it('mounts the full-day research trigger endpoint under the attendance router', () => {
    const postPaths = getMountedPostPaths(attendanceRoutes);

    expect(postPaths).toContain('/research-trigger/full-day');
  });
});
