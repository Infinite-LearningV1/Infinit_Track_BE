import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

const mockAxiosGet = jest.fn();

const mockVerifyToken = jest.fn((req, res, next) => {
  req.user = { id: 12, role_name: req.get('x-test-role') || 'Management' };
  next();
});

const mockRoleGuard = jest.fn((allowedRoles) => (req, res, next) => {
  const userRole = req.user?.role_name || req.user?.role?.name;
  if (!allowedRoles.includes(userRole)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
});

const mockUser = { findAll: jest.fn() };
const mockAttendance = { findAll: jest.fn() };
const mockLocation = { findAll: jest.fn() };
const mockLocationEvent = { findOne: jest.fn() };

const mockFuzzyEngine = {
  getDisciplineAhpWeights: jest.fn(),
  calculateDisciplineIndex: jest.fn(),
  getWfaAhpWeights: jest.fn(),
  calculateWfaScore: jest.fn(),
  categorizePlace: jest.fn()
};

jest.unstable_mockModule('axios', () => ({
  __esModule: true,
  default: { get: mockAxiosGet },
  get: mockAxiosGet
}));

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  __esModule: true,
  default: mockRoleGuard
}));

jest.unstable_mockModule('../src/models/index.js', () => ({
  User: mockUser,
  Attendance: mockAttendance,
  Location: mockLocation,
  LocationEvent: mockLocationEvent
}));

jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  __esModule: true,
  default: mockFuzzyEngine
}));

const { default: analysisRoutes } = await import('../src/routes/analysis.routes.js');

const app = express();
app.use(express.json());
app.use('/api/analysis', analysisRoutes);

const requestWfa = (query = 'lat=-0.895&lon=119.872&radius_meters=1000') =>
  request(app).get(`/api/analysis/fuzzy-ahp/wfa?${query}`).set('Authorization', 'Bearer test-token');

describe('analysis WFA fuzzy ahp contract', () => {
  const originalGeoapifyApiKey = process.env.GEOAPIFY_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GEOAPIFY_API_KEY = 'test-geoapify-key';
    mockFuzzyEngine.getWfaAhpWeights.mockReturnValue({
      location_type: 0.5,
      distance_factor: 0.3,
      amenity_score: 0.2,
      consistency_ratio: 0.042
    });
    mockFuzzyEngine.categorizePlace.mockReturnValue('cafe');
    mockFuzzyEngine.calculateWfaScore.mockResolvedValue({
      score: 87.25,
      label: 'Sangat Tinggi',
      breakdown: {
        location_score: 100,
        distance_score: 95,
        amenity_score: 80
      }
    });
  });

  afterAll(() => {
    if (originalGeoapifyApiKey === undefined) {
      delete process.env.GEOAPIFY_API_KEY;
    } else {
      process.env.GEOAPIFY_API_KEY = originalGeoapifyApiKey;
    }
  });

  it('returns Geoapify-backed WFA ranking contract with honest breakdown values', async () => {
    mockAxiosGet.mockResolvedValue({
      data: {
        features: [
          {
            properties: {
              place_id: 'geo-1',
              name: 'Palu Work Cafe',
              distance: 123,
              categories: ['catering.cafe'],
              amenities: { wifi: true, power_outlets: true, tables: true, quiet: true }
            },
            geometry: { coordinates: [119.873, -0.894] }
          }
        ]
      }
    });

    const res = await requestWfa();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      type: 'wfa',
      timezone: 'Asia/Jakarta',
      data_source: 'geoapify_live',
      consistency: {
        threshold: 0.1
      },
      weights: {
        method: "Chang's Extent Analysis"
      }
    });
    expect(res.body.data.ranking).toEqual([
      {
        rank: 1,
        place_id: 'geo-1',
        name: 'Palu Work Cafe',
        score: 87.25,
        label: 'Sangat Tinggi',
        breakdown: {
          location_type: 'cafe',
          distance_m: 123,
          amenity_score: 100
        }
      }
    ]);
    expect(res.body.data.ranking[0].breakdown).not.toMatchObject({
      distance_m: 1000,
      amenity_score: 50
    });
    expect(mockAxiosGet).toHaveBeenCalledWith(
      'https://api.geoapify.com/v2/places',
      expect.objectContaining({
        params: expect.objectContaining({
          filter: 'circle:119.872,-0.895,1000',
          apiKey: 'test-geoapify-key'
        })
      })
    );
  });

  it.each([
    { providerError: Object.assign(new Error('Unauthorized'), { response: { status: 401 } }), reason: 'auth_failed' },
    { providerError: Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' }), reason: 'timeout' },
    { providerError: Object.assign(new Error('Request timeout'), { response: { status: 408 } }), reason: 'timeout' },
    {
      providerError: Object.assign(new Error('Rate limited'), { response: { status: 429 } }),
      reason: 'quota_or_rate_limited'
    },
    { providerError: Object.assign(new Error('Provider error'), { response: { status: 503 } }), reason: 'provider_5xx' },
    { providerError: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }), reason: 'provider_unavailable' }
  ])('maps Geoapify $reason failure to provider unavailable', async ({ providerError, reason }) => {
    mockAxiosGet.mockRejectedValue(providerError);

    const res = await requestWfa();

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      code: 'AUTH_OR_PROVIDER_UNAVAILABLE',
      provider: 'geoapify',
      reason
    });
  });

  it('does not convert an unclassified Geoapify error into the provider-unavailable contract', async () => {
    mockAxiosGet.mockRejectedValue(Object.assign(new Error('Bad request'), { response: { status: 400 } }));

    const res = await requestWfa();

    expect(res.status).not.toBe(503);
    expect(res.body).not.toMatchObject({
      code: 'AUTH_OR_PROVIDER_UNAVAILABLE',
      provider: 'geoapify'
    });
  });

  it('returns an empty real response when Geoapify returns no places', async () => {
    mockAxiosGet.mockResolvedValue({ data: { features: [] } });

    const res = await requestWfa();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      type: 'wfa',
      timezone: 'Asia/Jakarta',
      data_source: 'geoapify_live',
      empty_real: true,
      distribution: {
        'Sangat Tinggi': 0,
        Tinggi: 0,
        Sedang: 0,
        Rendah: 0,
        'Sangat Rendah': 0
      },
      ranking: []
    });
    expect(mockFuzzyEngine.calculateWfaScore).not.toHaveBeenCalled();
  });
});
