import express from 'express';
import { jest } from '@jest/globals';
import request from 'supertest';

const mockAnalyze = jest.fn();

const mockVerifyToken = jest.fn((req, _res, next) => {
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

jest.unstable_mockModule('../src/services/wfaRecommendation.service.js', () => ({
  analyze: mockAnalyze
}));

jest.unstable_mockModule('../src/middlewares/authJwt.js', () => ({
  verifyToken: mockVerifyToken
}));

jest.unstable_mockModule('../src/middlewares/roleGuard.js', () => ({
  __esModule: true,
  default: mockRoleGuard
}));

const { default: analysisRoutes } = await import('../src/routes/analysis.routes.js');

const app = express();
app.use(express.json());
app.use('/api/analysis', analysisRoutes);

describe('analysis WFA fuzzy ahp contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps a missing schedule date as an untyped required-field validation item', async () => {
    const response = await request(app)
      .get('/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&radius_meters=1000')
      .set('Authorization', 'Bearer test-token')
      .expect(400);

    expect(response.body).toEqual({
      success: false,
      code: 'E_VALIDATION',
      message: 'schedule_date is required',
      errors: [{
        type: 'field',
        msg: 'schedule_date is required',
        path: 'schedule_date',
        location: 'query'
      }]
    });
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid calendar date', '2099-02-30', 'INVALID_SCHEDULE_DATE', 'Tanggal WFA tidak valid.'],
    ['past date', '2026-08-01', 'PAST_DATE_NOT_ALLOWED', 'Tanggal booking tidak boleh di masa lalu.'],
    ['same-day date', '2026-08-02', 'SAME_DAY_NOT_ALLOWED', 'Booking di hari yang sama tidak diperbolehkan.']
  ])('preserves the %s taxonomy in the query error item', async (_case, scheduleDate, code, message) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-02T04:00:00.000Z'));

    const response = await request(app)
      .get(
        `/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&radius_meters=1000&schedule_date=${scheduleDate}`
      )
      .set('Authorization', 'Bearer test-token')
      .expect(400);

    expect(response.body).toEqual({
      success: false,
      code: 'E_VALIDATION',
      message,
      errors: [{
        type: 'field',
        value: scheduleDate,
        msg: message,
        path: 'schedule_date',
        location: 'query',
        code
      }]
    });
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('delegates to canonical analysis and preserves truthful candidate statuses', async () => {
    const facilities = {
      internet_access: 1,
      air_conditioning: 1,
      toilets: 0,
      opening_hours: 1,
      wheelchair_accessibility: null
    };
    const candidates = [
      {
        place_id: 'ranked',
        name: 'Palu Work Cafe',
        address: 'Jl. Merdeka',
        latitude: -0.894,
        longitude: 119.873,
        status: 'ranked',
        distance_meters: 123,
        location_type: 'cafe',
        facility_score: 75,
        facility_confidence: 80,
        facilities,
        final_score: 87.25,
        final_label: 'Sangat Tinggi',
        rank: 1
      },
      {
        place_id: 'insufficient',
        name: 'Sparse Cafe',
        address: null,
        latitude: -0.893,
        longitude: 119.874,
        status: 'insufficient_facility_data',
        distance_meters: 240,
        location_type: 'cafe',
        facility_score: 100,
        facility_confidence: 20,
        facilities: { ...facilities, air_conditioning: null, toilets: null, opening_hours: null },
        final_score: null,
        final_label: null,
        rank: null
      },
      {
        place_id: 'failed',
        name: 'Unavailable Details',
        address: null,
        latitude: -0.892,
        longitude: 119.875,
        status: 'facility_enrichment_failed',
        distance_meters: 360,
        location_type: 'office',
        facility_score: null,
        facility_confidence: null,
        facilities: {
          internet_access: null,
          air_conditioning: null,
          toilets: null,
          opening_hours: null,
          wheelchair_accessibility: null
        },
        final_score: null,
        final_label: null,
        rank: null
      }
    ];
    const serviceResult = {
      candidates,
      searchCriteria: { search_radius_meters: 1000 },
      methodology: {
        approach: 'Fuzzy AHP facility-evidence scoring',
        criteria_weights: {
          location_type: 0.5,
          distance_factor: 0.3,
          facility_score: 0.2,
          consistency_ratio: 0
        },
        facility_matrix: {
          version: 'facility_equal_v1',
          criteria: ['internet_access', 'air_conditioning', 'toilets', 'opening_hours', 'wheelchair_accessibility'],
          weights: [0.2, 0.2, 0.2, 0.2, 0.2],
          consistency_ratio: 0,
          weighting_method: 'chang_extent'
        }
      }
    };
    mockAnalyze.mockResolvedValue(serviceResult);

    const response = await request(app)
      .get(
        '/api/analysis/fuzzy-ahp/wfa?lat=-0.895&lon=119.872&radius_meters=1000&schedule_date=2099-08-10'
      )
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: serviceResult,
      message: 'WFA Fuzzy AHP analysis retrieved successfully'
    });
    expect(mockAnalyze).toHaveBeenCalledWith({
      latitude: -0.895,
      longitude: 119.872,
      scheduleDate: '2099-08-10',
      radiusMeters: 1000
    });
    expect(response.body.data.candidates.map((candidate) => candidate.status)).toEqual([
      'ranked',
      'insufficient_facility_data',
      'facility_enrichment_failed'
    ]);
    expect(JSON.stringify(response.body)).not.toContain('amenity');
  });
});
