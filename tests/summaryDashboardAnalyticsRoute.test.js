import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

let authMode = 'allow';
let currentRole = 'Admin';

const mockVerifyToken = jest.fn((req, res, next) => {
  if (authMode === 'reject') {
    return res.status(401).json({
      success: false,
      message: 'No token provided'
    });
  }

  req.user = { id: 1, role_name: currentRole };
  next();
});

const mockGetSummaryReport = jest.fn((_req, res) => {
  res.status(200).json({ success: true, message: 'summary report ok' });
});

const mockGetSummaryReportPdf = jest.fn((_req, res) => {
  res.status(200).json({ success: true, message: 'summary report pdf ok' });
});

const mockGetSummaryReportExcel = jest.fn((_req, res) => {
  res.status(200).json({ success: true, message: 'summary report excel ok' });
});

const mockGetDashboardAnalytics = jest.fn((req, res) => {
  res.status(200).json({
    success: true,
    data: {
      period: req.query.period || '30d'
    },
    message: 'Dashboard analytics retrieved successfully'
  });
});

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

jest.unstable_mockModule('../src/controllers/summary.controller.js', () => ({
  getSummaryReport: mockGetSummaryReport,
  getSummaryReportPdf: mockGetSummaryReportPdf,
  getSummaryReportExcel: mockGetSummaryReportExcel,
  getDashboardAnalytics: mockGetDashboardAnalytics
}));

const { default: summaryRoutes } = await import('../src/routes/summary.routes.js');

const reportRouteCases = [
  ['/api/summary/reports', mockGetSummaryReport],
  ['/api/summary/reports/pdf', mockGetSummaryReportPdf],
  ['/api/summary/reports/excel', mockGetSummaryReportExcel]
];
const dashboardAnalyticsCanonicalPeriodCases = [
  ['daily', { period: 'daily' }],
  ['weekly', { period: 'weekly' }],
  ['monthly', { period: 'monthly' }],
  ['range', { period: 'range', from: '2026-05-01', to: '2026-05-31' }]
];

const app = express();
app.use(express.json());
app.use('/api/summary', summaryRoutes);

describe('summary routes', () => {
  beforeEach(() => {
    authMode = 'allow';
    currentRole = 'Admin';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it.each(reportRouteCases)('runs auth middleware before the report handler for %s', async (routePath, handler) => {
    authMode = 'reject';

    const res = await request(app).get(routePath);

    expect(res.status).toBe(401);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(reportRouteCases.flatMap(([routePath, handler]) => [
    [routePath, 'Admin', handler],
    [routePath, 'Management', handler]
  ]))('allows %s access to the report handler for %s', async (routePath, roleName, handler) => {
    currentRole = roleName;

    const res = await request(app).get(routePath);

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it('removes the deprecated /api/summary alias from runtime routing', async () => {
    const res = await request(app).get('/api/summary');

    expect(res.status).toBe(404);
    expect(mockGetSummaryReport).not.toHaveBeenCalled();
  });

  it('runs auth middleware before the dashboard analytics handler', async () => {
    authMode = 'reject';

    const res = await request(app).get('/api/summary/dashboard-analytics');

    expect(res.status).toBe(401);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockGetDashboardAnalytics).not.toHaveBeenCalled();
  });

  it.each(['Admin', 'Management'])('allows %s access to dashboard analytics', async (roleName) => {
    currentRole = roleName;

    const res = await request(app).get('/api/summary/dashboard-analytics');

    expect(res.status).toBe(200);
    expect(mockGetDashboardAnalytics).toHaveBeenCalled();
  });

  it.each(dashboardAnalyticsCanonicalPeriodCases)(
    'passes canonical %s period through to the dashboard analytics handler',
    async (_periodName, query) => {
      const res = await request(app).get('/api/summary/dashboard-analytics').query(query);

      expect(res.status).toBe(200);
      expect(mockGetDashboardAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining(query)
        }),
        expect.anything(),
        expect.anything()
      );
      expect(res.body.data.period).toBe(query.period);
    }
  );
});
