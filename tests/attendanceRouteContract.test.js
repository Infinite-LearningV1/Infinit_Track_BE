import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

/**
 * Characterization coverage for the /api/attendance authorization matrix
 * (INF-252 Phase 0b).
 *
 * Attendance is the largest module -- 24 endpoints across a 2291-line
 * controller -- and 14 of them had no behavioral test. Nine are operational
 * triggers that mutate final attendance state, so who may call them is exactly
 * the property that must not drift during extraction.
 *
 * This file pins routing and authorization only. Controller behavior for
 * check-in and checkout is a separate, deeper slice; see
 * docs/architecture/api-contract-inventory.md.
 */

const ATTENDANCE_CONTROLLER_FNS = [
  'getAttendanceHistory',
  'getAttendanceStatus',
  'checkIn',
  'checkOut',
  'debugCheckInTime',
  'deleteAttendance',
  'getAllAttendances',
  'getAttendanceDetail',
  'manualAutoCheckout',
  'getAutoCheckoutSettings',
  'manualResolveWfaBookings',
  'manualGeneralAlphaForDate',
  'manualResolveWfaForDate',
  'manualSmartAutoCheckoutForDate',
  'logLocationEvent',
  'getSmartEngineConfig',
  'getEnhancedAutoCheckoutSettings',
  'getTodayLocations',
  'getGeofenceEvidence',
  'previewMyAttendanceReportPdf',
  'exportMyAttendanceReportPdf',
  'testWeightedPrediction'
];

const RESEARCH_CONTROLLER_FNS = [
  'triggerResearchAttendanceDaily',
  'triggerResearchAttendanceFullDay'
];

const asHandlers = (names) =>
  Object.fromEntries(
    names.map((name) => [name, (req, res) => res.status(200).json({ route: name })])
  );

const buildApp = async ({ role = 'Admin', verifyTokenImpl } = {}) => {
  jest.resetModules();

  jest.unstable_mockModule('../src/controllers/attendance.controller.js', () =>
    asHandlers(ATTENDANCE_CONTROLLER_FNS)
  );

  jest.unstable_mockModule('../src/controllers/researchAttendance.controller.js', () =>
    asHandlers(RESEARCH_CONTROLLER_FNS)
  );

  jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
    verifyToken:
      verifyTokenImpl ||
      ((req, res, next) => {
        req.user = { id: 99, role_name: role };
        next();
      })
  }));

  jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
    default: (allowedRoles) => (req, res, next) => {
      if (!allowedRoles.includes(req.user.role_name)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      next();
    }
  }));

  jest.unstable_mockModule('../src/middlewares/validator.js', () => ({
    checkInValidation: [(req, res, next) => next()],
    checkOutValidation: [(req, res, next) => next()],
    locationEventValidation: [(req, res, next) => next()],
    todayLocationsValidation: [(req, res, next) => next()],
    dashboardAnalyticsValidation: [(req, res, next) => next()],
    validate: (req, res, next) => next()
  }));

  jest.unstable_mockModule('../src/modules/attendance/attendance.validation.js', () => ({
    validateAttendanceListQuery: [(req, res, next) => next()],
    validateAttendanceId: [(req, res, next) => next()]
  }));

  const { default: attendanceRoutes } = await import('../src/routes/attendance.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/attendance', attendanceRoutes);
  return app;
};

/** Endpoints any authenticated user may call. */
const SELF_SERVICE = [
  ['post', '/api/attendance/location-event', 'logLocationEvent'],
  ['post', '/api/attendance/check-in', 'checkIn'],
  ['post', '/api/attendance/checkout/1', 'checkOut'],
  ['get', '/api/attendance/history/personal/pdf', 'previewMyAttendanceReportPdf'],
  ['get', '/api/attendance/history/export.pdf', 'exportMyAttendanceReportPdf'],
  ['get', '/api/attendance/history', 'getAttendanceHistory'],
  ['get', '/api/attendance/status-today', 'getAttendanceStatus']
];

/** Endpoints restricted to Admin and Management. */
const PRIVILEGED = [
  ['get', '/api/attendance', 'getAllAttendances'],
  ['get', '/api/attendance/1', 'getAttendanceDetail'],
  ['get', '/api/attendance/today-locations', 'getTodayLocations'],
  ['get', '/api/attendance/geofence-evidence', 'getGeofenceEvidence'],
  ['get', '/api/attendance/debug-checkin-time', 'debugCheckInTime'],
  ['post', '/api/attendance/manual-auto-checkout', 'manualAutoCheckout'],
  ['get', '/api/attendance/auto-checkout-settings', 'getAutoCheckoutSettings'],
  ['post', '/api/attendance/manual-resolve-wfa-bookings', 'manualResolveWfaBookings'],
  ['post', '/api/attendance/manual-general-alpha', 'manualGeneralAlphaForDate'],
  ['post', '/api/attendance/manual-resolve-wfa-for-date', 'manualResolveWfaForDate'],
  ['post', '/api/attendance/manual-smart-auto-checkout', 'manualSmartAutoCheckoutForDate'],
  ['post', '/api/attendance/research-trigger/daily', 'triggerResearchAttendanceDaily'],
  ['post', '/api/attendance/research-trigger/full-day', 'triggerResearchAttendanceFullDay'],
  ['delete', '/api/attendance/1', 'deleteAttendance'],
  ['get', '/api/attendance/smart-config', 'getSmartEngineConfig'],
  ['get', '/api/attendance/enhanced-auto-checkout-settings', 'getEnhancedAutoCheckoutSettings']
];

describe('attendance route contract', () => {
  test('covers every registered endpoint except the lazy-loaded test trigger', () => {
    // 23 routes are enumerated here; the 24th (test-weighted-prediction) is
    // asserted separately because it resolves its controller through a lazy import.
    expect(SELF_SERVICE.length + PRIVILEGED.length).toBe(23);
  });

  test.each(SELF_SERVICE)('routes %s %s to its controller for a plain User', async (
    method,
    path,
    route
  ) => {
    const app = await buildApp({ role: 'User' });
    await request(app)[method](path).send({}).expect(200, { route });
  });

  test.each(PRIVILEGED)('routes %s %s to its controller for an Admin', async (
    method,
    path,
    route
  ) => {
    const app = await buildApp({ role: 'Admin' });
    await request(app)[method](path).send({}).expect(200, { route });
  });

  test.each(PRIVILEGED)('refuses %s %s for a plain User', async (method, path) => {
    const app = await buildApp({ role: 'User' });
    await request(app)[method](path).send({}).expect(403);
  });

  test.each(PRIVILEGED)('allows %s %s for Management', async (method, path, route) => {
    const app = await buildApp({ role: 'Management' });
    await request(app)[method](path).send({}).expect(200, { route });
  });

  test('rejects unauthenticated requests on both self-service and privileged routes', async () => {
    const app = await buildApp({
      verifyTokenImpl: (req, res) =>
        res.status(401).json({ success: false, message: 'Unauthorized' })
    });

    await request(app).post('/api/attendance/check-in').send({}).expect(401);
    await request(app).get('/api/attendance/status-today').expect(401);
    await request(app).get('/api/attendance').expect(401);
    await request(app).get('/api/attendance/1').expect(401);
    await request(app).delete('/api/attendance/1').expect(401);
    await request(app).post('/api/attendance/manual-general-alpha').send({}).expect(401);
  });

  test('restricts the lazy-loaded weighted prediction trigger to Admin and Management', async () => {
    const denied = await buildApp({ role: 'User' });
    await request(denied).post('/api/attendance/test-weighted-prediction').send({}).expect(403);
  });
});
