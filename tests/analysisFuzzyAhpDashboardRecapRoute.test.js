import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

const ALLOWED_TYPES = ['discipline', 'wfa', 'smart_ac'];

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

const mockFuzzyAhpDashboardRecapValidation = jest.fn((req, _res, next) => {
  const queryKeys = Object.keys(req.query);

  if (!queryKeys.includes('type')) {
    req.validationError = 'type is required';
    return next();
  }

  if (queryKeys.some((key) => key !== 'type')) {
    req.validationError = 'only type query parameter is allowed';
    return next();
  }

  if (!ALLOWED_TYPES.includes(req.query.type)) {
    req.validationError = 'type must be one of discipline, wfa, smart_ac';
    return next();
  }

  return next();
});

const mockValidate = jest.fn((req, res, next) => {
  if (!req.validationError) {
    return next();
  }

  return res.status(400).json({
    success: false,
    code: 'E_VALIDATION',
    message: req.validationError
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
  fuzzyAhpDashboardRecapValidation: [mockFuzzyAhpDashboardRecapValidation],
  validate: mockValidate,
  wfaFahpValidation: []
}));

const { default: analysisRoutes } = await import('../src/routes/analysis.routes.js');

const createAnalysisRoutesApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/analysis', analysisRoutes);
  return app;
};

const createDashboardRecapHarnessApp = () => {
  const app = express();
  app.use(express.json());

  app.use('/api/analysis', mockVerifyToken);
  app.get(
    '/api/analysis/fuzzy-ahp/dashboard',
    mockRoleGuard(['Admin', 'Management']),
    mockFuzzyAhpDashboardRecapValidation,
    mockValidate,
    mockGetFuzzyAhpDashboardRecap
  );

  return app;
};

const expectValidationFailure = async (app, path, expectedMessage) => {
  const res = await request(app).get(path);

  expect(res.status).toBe(400);
  expect(res.body).toEqual({
    success: false,
    code: 'E_VALIDATION',
    message: expectedMessage
  });
  expect(mockGetFuzzyAhpDashboardRecap).not.toHaveBeenCalled();

  return res;
};

describe('analysis fuzzy ahp dashboard recap route validation scaffold', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 E_VALIDATION when type query is missing', async () => {
    const app = createDashboardRecapHarnessApp();

    await expectValidationFailure(
      app,
      '/api/analysis/fuzzy-ahp/dashboard',
      'type is required'
    );
    expect(mockFuzzyAhpDashboardRecapValidation).toHaveBeenCalled();
    expect(mockValidate).toHaveBeenCalled();
  });

  it('returns 400 E_VALIDATION when type is outside discipline, wfa, and smart_ac', async () => {
    const app = createDashboardRecapHarnessApp();

    await expectValidationFailure(
      app,
      '/api/analysis/fuzzy-ahp/dashboard?type=attendance',
      'type must be one of discipline, wfa, smart_ac'
    );
  });

  it('returns 400 E_VALIDATION when extra query params are present', async () => {
    const app = createDashboardRecapHarnessApp();

    await expectValidationFailure(
      app,
      '/api/analysis/fuzzy-ahp/dashboard?type=discipline&period=monthly',
      'only type query parameter is allowed'
    );
  });

  it('returns 200 and the dashboard recap envelope for a valid type query', async () => {
    const app = createDashboardRecapHarnessApp();

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
    expect(mockGetFuzzyAhpDashboardRecap).toHaveBeenCalledTimes(1);
  });

  it('returns 403 for callers outside Admin and Management before validation or handler execution', async () => {
    const app = createDashboardRecapHarnessApp();

    const res = await request(app)
      .get('/api/analysis/fuzzy-ahp/dashboard?type=discipline')
      .set('x-test-role', 'User');

    expect(res.status).toBe(403);
    expect(mockFuzzyAhpDashboardRecapValidation).not.toHaveBeenCalled();
    expect(mockValidate).not.toHaveBeenCalled();
    expect(mockGetFuzzyAhpDashboardRecap).not.toHaveBeenCalled();
  });
});

describe('analysis fuzzy ahp dashboard recap route wiring red state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is not yet mounted on the real analysis router, so requests still return 404 until wiring is added', async () => {
    const app = createAnalysisRoutesApp();

    const res = await request(app).get('/api/analysis/fuzzy-ahp/dashboard?type=discipline');

    expect(res.status).toBe(404);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockFuzzyAhpDashboardRecapValidation).not.toHaveBeenCalled();
    expect(mockValidate).not.toHaveBeenCalled();
    expect(mockGetFuzzyAhpDashboardRecap).not.toHaveBeenCalled();
  });
});
