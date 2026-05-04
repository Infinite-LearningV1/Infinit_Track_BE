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
  res.status(200).json({ success: true, message: 'legacy summary ok' });
});

const mockGetDashboardAnalytics = jest.fn((req, res) => {
  res.status(200).json({
    success: true,
    data: {
      period: req.query.period || '30d'
    },
    message: 'Dashboard analytics endpoint is not implemented yet'
  });
});

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

jest.unstable_mockModule('../src/controllers/summary.controller.js', () => ({
  getSummaryReport: mockGetSummaryReport,
  getDashboardAnalytics: mockGetDashboardAnalytics
}));

const { default: summaryRoutes } = await import('../src/routes/summary.routes.js');

const app = express();
app.use(express.json());
app.use('/api/summary', summaryRoutes);

describe('summary dashboard analytics route', () => {
  beforeEach(() => {
    authMode = 'allow';
    currentRole = 'Admin';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('runs auth middleware before the dashboard analytics handler', async () => {
    authMode = 'reject';

    const res = await request(app).get('/api/summary/dashboard-analytics');

    expect(res.status).toBe(401);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockGetDashboardAnalytics).not.toHaveBeenCalled();
  });

  it.each(['Admin', 'Management'])(
    'allows %s access to dashboard analytics',
    async (roleName) => {
      currentRole = roleName;

      const res = await request(app).get('/api/summary/dashboard-analytics');

      expect(res.status).toBe(200);
      expect(mockGetDashboardAnalytics).toHaveBeenCalled();
    }
  );

  it('passes current_month through to the handler for a realistic dashboard filter', async () => {
    const res = await request(app).get('/api/summary/dashboard-analytics?period=current_month');

    expect(res.status).toBe(200);
    expect(mockGetDashboardAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ period: 'current_month' })
      }),
      expect.anything(),
      expect.anything()
    );
    expect(res.body).toEqual({
      success: true,
      data: { period: 'current_month' },
      message: 'Dashboard analytics endpoint is not implemented yet'
    });
  });

  it('accepts a custom range that is exactly 31 days long', async () => {
    const res = await request(app).get(
      '/api/summary/dashboard-analytics?period=custom&from=2026-05-01&to=2026-05-31'
    );

    expect(res.status).toBe(200);
    expect(mockGetDashboardAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          period: 'custom',
          from: '2026-05-01',
          to: '2026-05-31'
        })
      }),
      expect.anything(),
      expect.anything()
    );
  });

  it('returns 403 for unauthorized roles', async () => {
    currentRole = 'User';

    const res = await request(app).get('/api/summary/dashboard-analytics');

    expect(res.status).toBe(403);
    expect(mockGetDashboardAnalytics).not.toHaveBeenCalled();
  });

  it('returns 400 E_VALIDATION for an invalid period value', async () => {
    const res = await request(app).get('/api/summary/dashboard-analytics?period=invalid');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'E_VALIDATION'
    });
    expect(mockGetDashboardAnalytics).not.toHaveBeenCalled();
  });

  it('returns 400 E_VALIDATION when from uses a non-ISO date format', async () => {
    const res = await request(app).get(
      '/api/summary/dashboard-analytics?period=custom&from=05-01-2026&to=2026-05-31'
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'E_VALIDATION'
    });
    expect(mockGetDashboardAnalytics).not.toHaveBeenCalled();
  });

  it('returns 400 E_VALIDATION when custom dates are impossible calendar dates', async () => {
    const res = await request(app).get(
      '/api/summary/dashboard-analytics?period=custom&from=2026-04-01&to=2026-04-31'
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'E_VALIDATION'
    });
    expect(mockGetDashboardAnalytics).not.toHaveBeenCalled();
  });

  it('returns 400 E_VALIDATION when custom period is missing from or to', async () => {
    const res = await request(app).get('/api/summary/dashboard-analytics?period=custom&from=2026-05-01');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'E_VALIDATION'
    });
    expect(mockGetDashboardAnalytics).not.toHaveBeenCalled();
  });

  it('returns 400 E_VALIDATION when custom from is greater than to', async () => {
    const res = await request(app).get(
      '/api/summary/dashboard-analytics?period=custom&from=2026-05-10&to=2026-05-01'
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'E_VALIDATION'
    });
    expect(mockGetDashboardAnalytics).not.toHaveBeenCalled();
  });

  it('returns 400 E_VALIDATION when the custom range exceeds 31 days', async () => {
    const res = await request(app).get(
      '/api/summary/dashboard-analytics?period=custom&from=2026-05-01&to=2026-06-02'
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'E_VALIDATION'
    });
    expect(mockGetDashboardAnalytics).not.toHaveBeenCalled();
  });
});
