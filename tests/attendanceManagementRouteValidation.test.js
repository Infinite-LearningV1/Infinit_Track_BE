import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const getAllAttendances = jest.fn((_req, res) => res.json({ route: 'list' }));
const getAttendanceDetail = jest.fn((_req, res) => res.json({ route: 'detail' }));
const controllerNames = [
  'getAttendanceHistory', 'getAttendanceStatus', 'checkIn', 'checkOut',
  'debugCheckInTime', 'deleteAttendance', 'manualAutoCheckout',
  'getAutoCheckoutSettings', 'manualResolveWfaBookings', 'manualGeneralAlphaForDate',
  'manualResolveWfaForDate', 'manualSmartAutoCheckoutForDate', 'logLocationEvent',
  'getSmartEngineConfig', 'getEnhancedAutoCheckoutSettings', 'getTodayLocations',
  'getGeofenceEvidence', 'previewMyAttendanceReportPdf', 'exportMyAttendanceReportPdf',
  'testWeightedPrediction'
];
jest.unstable_mockModule('../src/controllers/attendance.controller.js', () => ({
  ...Object.fromEntries(
    controllerNames.map((name) => [name, (_req, res) => res.json({ route: name })])
  ),
  getAllAttendances,
  getAttendanceDetail
}));
jest.unstable_mockModule('../src/controllers/researchAttendance.controller.js', () => ({
  triggerResearchAttendanceDaily: (_req, res) => res.json({}),
  triggerResearchAttendanceFullDay: (_req, res) => res.json({})
}));
jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: (req, _res, next) => {
    req.user = { role_name: 'Admin' };
    next();
  }
}));
jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  default: () => (_req, _res, next) => next()
}));

const { default: routes } = await import('../src/routes/attendance.routes.js');
const app = express();
app.use('/api/attendance', routes);

test('list validation stops malformed pagination before the controller', async () => {
  const response = await request(app).get('/api/attendance?page=abc');
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('E_VALIDATION');
  expect(getAllAttendances).not.toHaveBeenCalled();
});

test('detail validation stops malformed IDs before the controller', async () => {
  const response = await request(app).get('/api/attendance/abc');
  expect(response.status).toBe(400);
  expect(response.body.code).toBe('E_VALIDATION');
  expect(getAttendanceDetail).not.toHaveBeenCalled();
});
