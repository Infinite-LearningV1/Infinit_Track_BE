import { jest } from '@jest/globals';

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const canonicalWeights = {
  location_type: 0.5,
  facility_score: 0.3,
  distance_factor: 0.2,
  consistency_ratio: 0.05
};

const loadWfa = async ({ recommendForUser = jest.fn(), weights = canonicalWeights } = {}) => {
  jest.resetModules();

  jest.unstable_mockModule('../src/services/wfaRecommendation.service.js', () => ({
    recommendForUser
  }));
  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: { error: jest.fn() }
  }));
  jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
    default: {
      getWfaAhpWeights: jest.fn(() => weights),
      calculateWfaScore: jest.fn(async () => ({ score: 82.4, label: 'Sangat Baik' })),
      getLocationTypeScore: jest.fn(() => 100),
      getDistanceFactorScore: jest.fn(() => 90)
    }
  }));

  return import('../src/controllers/wfa.controller.js');
};

describe('getWfaRecommendations', () => {
  it('forwards the authenticated request to the canonical recommendation service', async () => {
    const recommendForUser = jest.fn().mockResolvedValue({
      candidates: [
        {
          place_id: 'place-1',
          status: 'ranked',
          facility_score: 75,
          final_score: 82.4,
          rank: 1
        }
      ],
      searchCriteria: { radius_meters: 5000 },
      methodology: { approach: 'facility evidence' }
    });
    const { getWfaRecommendations } = await loadWfa({ recommendForUser });
    const res = buildRes();

    await getWfaRecommendations(
      {
        user: { id: 7 },
        query: { lat: '-0.895', lng: '119.872', schedule_date: '2099-08-10' }
      },
      res,
      jest.fn()
    );

    expect(recommendForUser).toHaveBeenCalledWith({
      userId: 7,
      latitude: -0.895,
      longitude: 119.872,
      scheduleDate: '2099-08-10'
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      data: {
        search_criteria: { radius_meters: 5000 },
        fahp_methodology: { approach: 'facility evidence' }
      },
      message: 'Rekomendasi WFA berhasil diambil.'
    });
    const recommendation = res.json.mock.calls[0][0].data.recommendations[0];
    expect(recommendation).toEqual(
      expect.objectContaining({ status: 'ranked', facility_score: 75, final_score: 82.4 })
    );
    expect(recommendation).not.toHaveProperty('real_data_analysis');
    expect(recommendation).not.toHaveProperty('suitability_score');
  });

  it('forwards canonical provider and eligibility errors to the shared error handler', async () => {
    const error = Object.assign(new Error('Geoapify unavailable'), {
      code: 'WFA_PROVIDER_UNAVAILABLE',
      status: 503
    });
    const { getWfaRecommendations } = await loadWfa({
      recommendForUser: jest.fn().mockRejectedValue(error)
    });
    const res = buildRes();
    const next = jest.fn();

    await getWfaRecommendations(
      {
        user: { id: 7 },
        query: { lat: '-0.895', lng: '119.872', schedule_date: '2099-08-10' }
      },
      res,
      next
    );

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('getWfaAhpConfig', () => {
  it('exposes facility-named canonical weights', async () => {
    const { getWfaAhpConfig } = await loadWfa();
    const res = buildRes();

    await getWfaAhpConfig({}, res, jest.fn());

    expect(res.json.mock.calls[0][0].data.current_weights).toEqual({
      location_type: 0.5,
      facility_score: 0.3,
      distance_factor: 0.2
    });
    expect(res.json.mock.calls[0][0].data.criteria_explanation).toHaveProperty('facility_score');
    expect(res.json.mock.calls[0][0].data.criteria_explanation).not.toHaveProperty('amenity_score');
  });
});

describe('testFuzzyAhp', () => {
  it('rejects the legacy amenity_score test input', async () => {
    const { testFuzzyAhp } = await loadWfa();
    const res = buildRes();

    await testFuzzyAhp(
      { body: { place_data: { properties: { amenity_score: 90, distance: 100 } } } },
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: 'E_VALIDATION' });
  });

  it('rejects legacy amenity_score custom weights even with canonical facility evidence', async () => {
    const { testFuzzyAhp } = await loadWfa();
    const res = buildRes();

    await testFuzzyAhp(
      {
        body: {
          custom_weights: {
            location_type: 0.4,
            distance_factor: 0.35,
            facility_score: 0.25,
            amenity_score: 0.1
          },
          place_data: { properties: { facility_score: 90, distance: 100 } }
        }
      },
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code: 'E_VALIDATION' });
  });
});
