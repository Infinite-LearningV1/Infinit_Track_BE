import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

const mockVerifyToken = jest.fn((req, _res, next) => {
  req.user = { id: 12, role_name: req.get('x-test-role') || 'Admin' };
  next();
});

const mockRoleGuard = jest.fn((allowedRoles) => (req, res, next) => {
  const userRole = req.user?.role_name || req.user?.role?.name;
  if (!allowedRoles.includes(userRole)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
});

const mockGetFuzzyAhpDashboardRecap = jest.fn((req, res) => {
  res.status(200).json({
    success: true,
    data: {
      type: req.query.type,
      generated_at: '2026-06-26T10:15:00+07:00',
      timezone: 'Asia/Jakarta',
      requested_window: { period: 'monthly' },
      executed_window: {
        start_at: '2026-06-01T00:00:00+07:00',
        end_at: '2026-06-26T10:15:00+07:00'
      },
      status: 'ready',
      needs_data: false,
      consistency: {
        cr_value: 0.058,
        threshold: 0.1,
        is_consistent: true,
        label: 'Konsisten'
      },
      criteria_weights: [
        {
          key: 'attendance',
          label: 'Kehadiran',
          value: 0.352
        }
      ],
      ranking_preview: {
        top_n: 5,
        items: []
      },
      distribution: []
    },
    message: 'Fuzzy AHP dashboard recap retrieved successfully'
  });
});

jest.unstable_mockModule('../src/controllers/analysis.controller.js', () => ({
  getDisciplineFahp: jest.fn(),
  getFuzzyAhpAnalysis: jest.fn(),
  getFuzzyAhpDashboardRecap: mockGetFuzzyAhpDashboardRecap,
  getSmartAcFahp: jest.fn(),
  getWfaFahp: jest.fn()
}));

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  __esModule: true,
  default: mockRoleGuard
}));

jest.unstable_mockModule('../src/middlewares/validator.js', () => ({
  disciplineFahpValidation: [],
  validate: jest.fn((req, _res, next) => next()),
  wfaFahpValidation: [],
  fuzzyAhpDashboardRecapValidation: [jest.fn((req, _res, next) => next())]
}));

const { default: analysisRoutes } = await import('../src/routes/analysis.routes.js');

const app = express();
app.use(express.json());
app.use('/api/analysis', analysisRoutes);

describe('analysis fuzzy ahp dashboard recap route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the dashboard recap envelope for a valid discipline request', async () => {
    const res = await request(app).get('/api/analysis/fuzzy-ahp/dashboard?type=discipline');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: expect.objectContaining({
        type: 'discipline',
        timezone: 'Asia/Jakarta',
        requested_window: { period: 'monthly' },
        executed_window: {
          start_at: expect.stringMatching(/\+07:00$/),
          end_at: expect.stringMatching(/\+07:00$/)
        },
        status: 'ready',
        needs_data: false,
        consistency: expect.objectContaining({
          cr_value: expect.any(Number),
          threshold: 0.1,
          is_consistent: expect.any(Boolean),
          label: expect.any(String)
        }),
        criteria_weights: expect.any(Array),
        ranking_preview: {
          top_n: 5,
          items: expect.any(Array)
        },
        distribution: expect.any(Array)
      }),
      message: 'Fuzzy AHP dashboard recap retrieved successfully'
    });
  });

  it('returns 403 for callers outside Admin and Management', async () => {
    const res = await request(app)
      .get('/api/analysis/fuzzy-ahp/dashboard?type=discipline')
      .set('x-test-role', 'User');

    expect(res.status).toBe(403);
    expect(mockGetFuzzyAhpDashboardRecap).not.toHaveBeenCalled();
  });

  it('keeps the dashboard recap route mounted under /api/analysis', async () => {
    const res = await request(app).get('/api/analysis/fuzzy-ahp/dashboard?type=wfa');

    expect(res.status).toBe(200);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockGetFuzzyAhpDashboardRecap).toHaveBeenCalled();
  });
});
