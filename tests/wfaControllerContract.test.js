import { jest } from '@jest/globals';

/**
 * Characterization coverage for the /api/wfa controllers
 * (INF-252 Phase 0b).
 *
 * Before this file the three WFA endpoints had only route-exposure coverage --
 * wfaRouteExposure.test.js asserts which paths must NOT exist. Nothing pinned
 * their behavior.
 *
 * The FAHP engine is mocked throughout. FAHP theory is locked (CLAUDE.md), so
 * these tests deliberately assert the controller's orchestration and its
 * error contract, never the algorithm's numbers. That boundary is also the one
 * Phase 4 will cut along: Geoapify integration and scoring orchestration
 * become separate units.
 */

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const loadWfa = async ({
  axiosGet,
  radiusSetting = { setting_value: '5000' },
  apiKey = 'test-geoapify-key'
} = {}) => {
  jest.resetModules();

  const get = axiosGet || jest.fn().mockResolvedValue({ data: { features: [] } });

  jest.unstable_mockModule('axios', () => ({ default: { get } }));

  jest.unstable_mockModule('../src/models/settings.model.js', () => ({
    default: { findOne: jest.fn().mockResolvedValue(radiusSetting) }
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
  }));

  jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
    default: {
      getWfaAhpWeights: () => ({
        location_type: 0.5,
        facility_score: 0.3,
        distance_factor: 0.2,
        consistency_ratio: 0.05
      }),
      calculateWfaScore: jest.fn(async () => ({
        final_score: 78,
        label: 'SANGAT SESUAI',
        weights: [0.5, 0.2, 0.3],
        breakdown: {}
      })),
      getLegacyWfaAmenityWeights: () => ({
        location_type: 0.5,
        amenity_score: 0.3,
        distance_factor: 0.2,
        consistency_ratio: 0.05
      }),
      calculateLegacyWfaAmenityScore: jest.fn(async () => ({
        score: 78,
        label: 'SANGAT SESUAI',
        breakdown: {}
      })),
      getWfaScoreLabel: () => 'SANGAT SESUAI',
      getLocationTypeScore: () => 100,
      getDistanceFactorScore: () => 90,
      categorizePlace: () => 'office',
      getCategoryDisplayName: () => 'Kantor'
    }
  }));

  jest.unstable_mockModule('../src/utils/geofence.js', () => ({
    calculateDistance: jest.fn(() => 120),
    getJakartaTime: jest.fn(() => new Date()),
    getJakartaDateString: jest.fn(() => '2026-07-28'),
    getCurrentTimeForDB: jest.fn(() => new Date()),
    toJakartaTime: jest.fn((d) => d)
  }));

  const previousKey = process.env.GEOAPIFY_API_KEY;
  const previousLegacy = process.env.GEOAPIFY_KEY;

  if (apiKey === null) {
    delete process.env.GEOAPIFY_API_KEY;
    delete process.env.GEOAPIFY_KEY;
  } else {
    process.env.GEOAPIFY_API_KEY = apiKey;
  }

  const mod = await import('../src/controllers/wfa.controller.js');

  const restoreEnv = () => {
    if (previousKey === undefined) delete process.env.GEOAPIFY_API_KEY;
    else process.env.GEOAPIFY_API_KEY = previousKey;
    if (previousLegacy === undefined) delete process.env.GEOAPIFY_KEY;
    else process.env.GEOAPIFY_KEY = previousLegacy;
  };

  return { ...mod, get, restoreEnv };
};

const queryReq = (query) => ({ query, user: { id: 1, role_name: 'User' } });

describe('getWfaRecommendations input validation', () => {
  afterEach(() => jest.clearAllMocks());

  it.each([
    ['both coordinates missing', {}, 'Parameter lat dan lng wajib diisi'],
    ['only lat supplied', { lat: '-0.89' }, 'Parameter lat dan lng wajib diisi'],
    ['non-numeric coordinates', { lat: 'abc', lng: 'def' }, 'Format koordinat tidak valid'],
    ['latitude above range', { lat: '91', lng: '119.87' }, 'Latitude harus antara -90 dan 90'],
    ['longitude below range', { lat: '-0.89', lng: '-181' }, 'Longitude harus antara -180 dan 180']
  ])('rejects %s', async (_name, query, message) => {
    const { getWfaRecommendations, get, restoreEnv } = await loadWfa();
    const res = buildRes();

    await getWfaRecommendations(queryReq(query), res, jest.fn());
    restoreEnv();

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_VALIDATION',
      message
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('returns E_CONFIG when no Geoapify key is configured', async () => {
    const { getWfaRecommendations, get, restoreEnv } = await loadWfa({ apiKey: null });
    const res = buildRes();

    await getWfaRecommendations(queryReq({ lat: '-0.89', lng: '119.87' }), res, jest.fn());
    restoreEnv();

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_CONFIG',
      message: 'API key Geoapify tidak ditemukan'
    });
    expect(get).not.toHaveBeenCalled();
  });
});

describe('getWfaRecommendations Geoapify error contract', () => {
  afterEach(() => jest.clearAllMocks());

  const failWith = (error) => jest.fn().mockRejectedValue(error);

  // Argument order matters: the title placeholders consume the first three
  // entries, so the error shape goes last. Timeout codes are covered
  // separately below because they trigger the retry loop.
  it.each([
    ['ENOTFOUND', 503, 'E_SERVICE_UNAVAILABLE', { code: 'ENOTFOUND' }],
    ['ECONNREFUSED', 503, 'E_SERVICE_UNAVAILABLE', { code: 'ECONNREFUSED' }],
    ['HTTP 401', 500, 'E_API_KEY', { response: { status: 401 } }],
    ['HTTP 403', 500, 'E_API_KEY', { response: { status: 403 } }],
    ['HTTP 429', 429, 'E_RATE_LIMIT', { response: { status: 429 } }],
    ['HTTP 502', 503, 'E_EXTERNAL_SERVER', { response: { status: 502 } }]
  ])('maps %s to %i %s', async (_name, status, code, errorShape) => {
    const error = Object.assign(new Error('geoapify failed'), errorShape);
    const { getWfaRecommendations, get, restoreEnv } = await loadWfa({
      axiosGet: failWith(error)
    });
    const res = buildRes();
    const next = jest.fn();

    await getWfaRecommendations(queryReq({ lat: '-0.89', lng: '119.87' }), res, next);
    restoreEnv();

    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: false, code });
    expect(next).not.toHaveBeenCalled();
    // Non-timeout failures are not retried.
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([['ECONNABORTED'], ['ETIMEDOUT']])(
    'retries %s twice with a progressive delay, then answers 408',
    async (code) => {
      jest.useFakeTimers();

      const error = Object.assign(new Error('geoapify timeout'), { code });
      const { getWfaRecommendations, get, restoreEnv } = await loadWfa({
        axiosGet: failWith(error)
      });
      const res = buildRes();
      const next = jest.fn();

      const pending = getWfaRecommendations(queryReq({ lat: '-0.89', lng: '119.87' }), res, next);

      // Progressive backoff is 1000ms then 2000ms; nothing else should elapse.
      await jest.advanceTimersByTimeAsync(3000);
      await pending;

      restoreEnv();
      jest.useRealTimers();

      // Initial attempt plus two retries.
      expect(get).toHaveBeenCalledTimes(3);
      expect(res.status).toHaveBeenCalledWith(408);
      expect(res.json.mock.calls[0][0]).toMatchObject({
        success: false,
        code: 'E_TIMEOUT'
      });
      expect(next).not.toHaveBeenCalled();
    }
  );

  it('forwards an unrecognised failure to the error handler', async () => {
    const error = new Error('something else entirely');
    const { getWfaRecommendations, restoreEnv } = await loadWfa({ axiosGet: failWith(error) });
    const res = buildRes();
    const next = jest.fn();

    await getWfaRecommendations(queryReq({ lat: '-0.89', lng: '119.87' }), res, next);
    restoreEnv();

    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('getWfaRecommendations Geoapify request contract', () => {
  afterEach(() => jest.clearAllMocks());

  it('uses the configured search radius from settings', async () => {
    const { getWfaRecommendations, get, restoreEnv } = await loadWfa({
      radiusSetting: { setting_value: '12000' }
    });
    const res = buildRes();

    await getWfaRecommendations(queryReq({ lat: '-0.89', lng: '119.87' }), res, jest.fn());
    restoreEnv();

    expect(get).toHaveBeenCalledWith(
      'https://api.geoapify.com/v2/places',
      expect.objectContaining({
        params: expect.objectContaining({
          filter: expect.stringContaining('12000')
        })
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('falls back to the default radius when the setting is absent', async () => {
    const { getWfaRecommendations, get, restoreEnv } = await loadWfa({ radiusSetting: null });
    const res = buildRes();

    await getWfaRecommendations(queryReq({ lat: '-0.89', lng: '119.87' }), res, jest.fn());
    restoreEnv();

    expect(get).toHaveBeenCalledWith(
      'https://api.geoapify.com/v2/places',
      expect.objectContaining({
        params: expect.objectContaining({ filter: expect.stringContaining('5000') })
      })
    );
  });

  it('returns an empty recommendation list without failing', async () => {
    const { getWfaRecommendations, restoreEnv } = await loadWfa();
    const res = buildRes();
    const next = jest.fn();

    await getWfaRecommendations(queryReq({ lat: '-0.89', lng: '119.87' }), res, next);
    restoreEnv();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.recommendations).toEqual([]);
  });
});

describe('getWfaAhpConfig', () => {
  afterEach(() => jest.clearAllMocks());

  it('exposes the engine weights and derives is_consistent from the ratio', async () => {
    const { getWfaAhpConfig, restoreEnv } = await loadWfa();
    const res = buildRes();

    await getWfaAhpConfig({}, res, jest.fn());
    restoreEnv();

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.current_weights).toEqual({
      location_type: 0.5,
      facility_score: 0.3,
      distance_factor: 0.2
    });
    expect(body.data.consistency_ratio).toBe(0.05);
    // is_consistent is the controller's own rule: ratio <= 0.1
    expect(body.data.is_consistent).toBe(true);
    expect(body.data.criteria_explanation.facility_score).toBe(
      'Penilaian berdasarkan internet_access, air_conditioning, toilets, opening_hours, dan wheelchair accessibility.'
    );
    expect(body.data.criteria_explanation.facility_score).not.toMatch(
      /brand recognition|payment options|keragaman kategori/i
    );
  });
});

describe('testFuzzyAhp', () => {
  afterEach(() => jest.clearAllMocks());

  it('requires place_data', async () => {
    const { testFuzzyAhp, restoreEnv } = await loadWfa();
    const res = buildRes();

    await testFuzzyAhp({ body: {} }, res, jest.fn());
    restoreEnv();

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Parameter place_data wajib diisi untuk testing'
    });
  });

  it('scores the supplied place and echoes the scenario name', async () => {
    const { testFuzzyAhp, restoreEnv } = await loadWfa();
    const res = buildRes();
    const next = jest.fn();

    await testFuzzyAhp(
      {
        body: {
          place_data: { properties: { name: 'Kafe Uji', distance: 100, facility_score: 90 } },
          scenario: 'skenario-1'
        }
      },
      res,
      next
    );
    restoreEnv();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.scenario).toBe('skenario-1');
  });

  it('falls back to the place name when no scenario is given', async () => {
    const { testFuzzyAhp, restoreEnv } = await loadWfa();
    const res = buildRes();

    await testFuzzyAhp(
      { body: { place_data: { properties: { name: 'Kafe Uji', distance: 100, facility_score: 90 } } } },
      res,
      jest.fn()
    );
    restoreEnv();

    expect(res.json.mock.calls[0][0].data.scenario).toBe('Kafe Uji');
  });
});
