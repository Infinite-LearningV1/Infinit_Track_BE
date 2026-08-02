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
      type_label: 'Discipline',
      generated_at: '2026-06-26T00:00:00+07:00',
      timezone: 'Asia/Jakarta',
      requested_window: {
        period: 'monthly'
      },
      executed_window: {
        start_at: '2026-05-27T00:00:00+07:00',
        end_at: '2026-06-26T00:00:00+07:00'
      },
      status: 'ready',
      needs_data: false,
      consistency: {
        CR: 0.01,
        threshold: 0.1,
        is_consistent: true,
        summary_label: 'Konsistensi dapat diterima'
      },
      criteria_weights: [
        { key: 'attendance', label: 'attendance', display_label: 'Attendance', value: 0.4 }
      ],
      ranking_preview: {
        top_n: 5,
        items: [
          {
            rank: 1,
            id: 7,
            name: 'Andi',
            score: 87.5,
            label: 'Sangat Tinggi'
          }
        ]
      },
      distribution: {
        'Sangat Tinggi': 1,
        Tinggi: 0,
        Sedang: 0,
        Rendah: 0,
        'Sangat Rendah': 0
      }
    },
    message: 'Fuzzy AHP dashboard recap retrieved successfully'
  });
});

const mockUserFindAll = jest.fn();
const mockAttendanceFindAll = jest.fn();
const mockBookingFindOne = jest.fn();
const mockLocationFindAll = jest.fn();
const mockLocationFindByPk = jest.fn();
const mockLocationEventFindOne = jest.fn();
const mockLocationEventFindAll = jest.fn();

const mockGetDisciplineAhpWeights = jest.fn(() => ({
  alpha_rate: 0.4,
  lateness_severity: 0.3,
  lateness_frequency: 0.2,
  work_focus: 0.1,
  consistency_ratio: 0.01
}));
const mockCalculateDisciplineIndex = jest.fn(async () => ({
  score: 87.5,
  label: 'Sangat Tinggi',
  breakdown: {}
}));
const mockGetWfaAhpWeights = jest.fn(() => ({
  location_type: 0.5,
  distance_factor: 0.3,
  facility_score: 0.2,
  consistency_ratio: 0.01
}));
const mockCalculateWfaScore = jest.fn(async () => ({
  score: 82.3,
  label: 'Tinggi'
}));
const mockGetLegacyWfaAmenityWeights = jest.fn(() => ({
  location_type: 0.5,
  distance_factor: 0.3,
  amenity_score: 0.2,
  consistency_ratio: 0.01
}));
const mockCalculateLegacyWfaAmenityScore = jest.fn(async () => ({
  score: 82.3,
  label: 'Tinggi'
}));
const mockCategorizePlace = jest.fn(() => 'office');
const mockGetLocationTypeScore = jest.fn(() => 40);
const mockGetDistanceFactorScore = jest.fn(() => 66.67);
const mockGetSmartAcAhpWeights = jest.fn(() => ({
  history: 0.4,
  checkin_pattern: 0.3,
  context: 0.2,
  transition: 0.1,
  consistency_ratio: 0.043,
  consistency_index: 0.01,
  lambda_max: 4.1
}));
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

jest.unstable_mockModule('../src/models/index.js', () => ({
  Attendance: { findAll: mockAttendanceFindAll },
  Booking: { findOne: mockBookingFindOne },
  Location: { findAll: mockLocationFindAll, findByPk: mockLocationFindByPk },
  LocationEvent: { findOne: mockLocationEventFindOne, findAll: mockLocationEventFindAll },
  User: { findAll: mockUserFindAll }
}));

jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  default: {
    getDisciplineAhpWeights: mockGetDisciplineAhpWeights,
    calculateDisciplineIndex: mockCalculateDisciplineIndex,
    getWfaAhpWeights: mockGetWfaAhpWeights,
    calculateWfaScore: mockCalculateWfaScore,
    getLegacyWfaAmenityWeights: mockGetLegacyWfaAmenityWeights,
    calculateLegacyWfaAmenityScore: mockCalculateLegacyWfaAmenityScore,
    getLocationTypeScore: mockGetLocationTypeScore,
    getDistanceFactorScore: mockGetDistanceFactorScore,
    categorizePlace: mockCategorizePlace,
    getSmartAcAhpWeights: mockGetSmartAcAhpWeights
  }
}));

const { default: analysisRoutes } = await import('../src/routes/analysis.routes.js');
const {
  buildFuzzyAhpDashboardRecapPayload,
  getWibAnalysisWindow
} = await import('../src/services/fuzzyAhpAnalysis.service.js');

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

  it.each([
    '/api/analysis/fuzzy-ahp/dashboard?type=discipline&period=monthly',
    '/api/analysis/fuzzy-ahp/dashboard?type=discipline&from=2026-06-01',
    '/api/analysis/fuzzy-ahp/dashboard?type=discipline&to=2026-06-30'
  ])('returns 400 E_VALIDATION when extra query params are present: %s', async (path) => {
    const app = createDashboardRecapHarnessApp();

    await expectValidationFailure(app, path, 'only type query parameter is allowed');
  });

  it('returns 200 success response for a valid type query', async () => {
    const app = createDashboardRecapHarnessApp();

    const res = await request(app).get('/api/analysis/fuzzy-ahp/dashboard?type=discipline');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        type: 'discipline',
        type_label: 'Discipline',
        generated_at: '2026-06-26T00:00:00+07:00',
        timezone: 'Asia/Jakarta',
        requested_window: {
          period: 'monthly'
        },
        executed_window: {
          start_at: '2026-05-27T00:00:00+07:00',
          end_at: '2026-06-26T00:00:00+07:00'
        },
        status: 'ready',
        needs_data: false,
        consistency: {
          CR: 0.01,
          threshold: 0.1,
          is_consistent: true,
          summary_label: 'Konsistensi dapat diterima'
        },
        criteria_weights: [
          {
            key: 'attendance',
            label: 'attendance',
            display_label: 'Attendance',
            value: 0.4
          }
        ],
        ranking_preview: {
          top_n: 5,
          items: [
            {
              rank: 1,
              id: 7,
              name: 'Andi',
              score: 87.5,
              label: 'Sangat Tinggi'
            }
          ]
        },
        distribution: {
          'Sangat Tinggi': 1,
          Tinggi: 0,
          Sedang: 0,
          Rendah: 0,
          'Sangat Rendah': 0
        }
      },
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

describe('analysis fuzzy ahp dashboard recap real router wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mounts the dashboard recap route on the real analysis router', async () => {
    const app = createAnalysisRoutesApp();

    const res = await request(app).get('/api/analysis/fuzzy-ahp/dashboard?type=discipline');

    expect(res.status).toBe(200);
    expect(mockVerifyToken).toHaveBeenCalled();
    expect(mockFuzzyAhpDashboardRecapValidation).toHaveBeenCalled();
    expect(mockValidate).toHaveBeenCalled();
    expect(mockGetFuzzyAhpDashboardRecap).toHaveBeenCalledTimes(1);
  });
});

describe('fuzzy ahp dashboard recap service behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDisciplineAhpWeights.mockReturnValue({
      alpha_rate: 0.4,
      lateness_severity: 0.3,
      lateness_frequency: 0.2,
      work_focus: 0.1,
      consistency_ratio: 0.01
    });
    mockCalculateDisciplineIndex.mockResolvedValue({
      score: 87.5,
      label: 'Sangat Tinggi',
      breakdown: {}
    });
    mockGetLegacyWfaAmenityWeights.mockReturnValue({
      location_type: 0.5,
      distance_factor: 0.3,
      amenity_score: 0.2,
      consistency_ratio: 0.01
    });
    mockCalculateLegacyWfaAmenityScore.mockResolvedValue({
      score: 82.3,
      label: 'Tinggi'
    });
    mockCategorizePlace.mockReturnValue('office');
    mockLocationFindByPk.mockResolvedValue(null);
    mockLocationEventFindOne.mockResolvedValue(null);
    mockLocationEventFindAll.mockResolvedValue([]);
    mockLocationFindAll.mockResolvedValue([]);
    mockUserFindAll.mockResolvedValue([]);
    mockAttendanceFindAll.mockResolvedValue([]);
  });

  it('returns an approximately 30-day monthly analysis window', () => {
    const { startAt, endAt } = getWibAnalysisWindow('monthly');
    const daysDiff = Math.floor((endAt.getTime() - startAt.getTime()) / (1000 * 60 * 60 * 24));

    expect(daysDiff).toBeGreaterThanOrEqual(25);
    expect(daysDiff).toBeLessThanOrEqual(31);
  });

  it('returns an explicit empty discipline recap when attendance data is missing', async () => {
    mockUserFindAll.mockResolvedValue([{ id_users: 12, full_name: 'Andi' }]);
    mockAttendanceFindAll.mockResolvedValue([]);

    const payload = await buildFuzzyAhpDashboardRecapPayload({ type: 'discipline' });

    expect(payload.status).toBe('empty');
    expect(payload.needs_data).toBe(true);
    expect(payload.reason).toBe('NO_DISCIPLINE_DATA_IN_WINDOW');
    expect(payload.criteria_weights).toBeNull();
  });

  it('returns empty wfa recap when there are no monthly location events', async () => {
    mockLocationFindAll.mockResolvedValue([
      {
        location_id: 3,
        description: 'Office Hub',
        latitude: '-6.2',
        longitude: '106.8'
      }
    ]);

    const payload = await buildFuzzyAhpDashboardRecapPayload({ type: 'wfa' });

    expect(payload.status).toBe('empty');
    expect(payload.needs_data).toBe(true);
    expect(payload.ranking_preview.items).toEqual([]);
  });

  it('keeps wfa recap ready when windowed location activity exists', async () => {
    mockLocationEventFindAll.mockResolvedValue([{ location_id: 3 }]);
    mockLocationFindAll.mockResolvedValue([
      {
        location_id: 3,
        description: 'Office Hub',
        latitude: '-6.2',
        longitude: '106.8'
      },
      {
        location_id: 4,
        description: 'Unused Hub',
        latitude: '-6.21',
        longitude: '106.81'
      }
    ]);

    const payload = await buildFuzzyAhpDashboardRecapPayload({ type: 'wfa' });

    expect(payload.status).toBe('ready');
    expect(payload.needs_data).toBe(false);
    expect(payload.criteria_weights).toHaveLength(3);
    expect(payload.ranking_preview.items).toHaveLength(1);
    expect(payload.ranking_preview.items[0].id).toBe(3);
  });

  it('returns empty smart_ac recap when all users lack monthly attendance evidence', async () => {
    mockUserFindAll.mockResolvedValue([{ id_users: 12, full_name: 'Andi' }]);

    const payload = await buildFuzzyAhpDashboardRecapPayload({ type: 'smart_ac' });

    expect(payload.status).toBe('empty');
    expect(payload.needs_data).toBe(true);
    expect(payload.ranking_preview.items).toEqual([]);
  });
});
