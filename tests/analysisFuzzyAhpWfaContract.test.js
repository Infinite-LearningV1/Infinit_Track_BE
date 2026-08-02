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
      methodology: { approach: 'Fuzzy AHP facility-evidence scoring' }
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
