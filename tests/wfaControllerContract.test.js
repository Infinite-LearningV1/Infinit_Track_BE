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
  consistency_ratio: 0.05,
  weighting_method: 'chang_extent',
  version: 'wfa_fahp_v1'
};
const methodology = {
  approach: 'Fuzzy AHP facility-evidence scoring',
  criteria_weights: canonicalWeights,
  facility_matrix: {
    version: 'facility_equal_v1',
    criteria: ['internet_access', 'air_conditioning', 'toilets', 'opening_hours', 'wheelchair_accessibility'],
    weights: [0.2, 0.2, 0.2, 0.2, 0.2],
    consistency_ratio: 0,
    weighting_method: 'chang_extent'
  }
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

const loadBookingController = async ({
  scoreResult = {
    status: 'ranked',
    suitabilityScore: 82.4,
    suitabilityLabel: 'Sangat Baik',
    scoringSnapshot: {
      schema_version: 1,
      methodology_version: 'wfa_fahp_v1',
      captured_at: '2026-08-15T01:02:03.000Z',
      criteria: {
        location_type_score: 40,
        distance_factor_score: 95,
        facility_score: 75
      },
      methodology: {
        weights: {
          location_type: 0.5,
          distance_factor: 0.3,
          facility_score: 0.2
        },
        consistency_ratio: 0.05,
        weighting_method: 'chang_extent'
      },
      evidence: {
        place_id: 'nearest',
        location_type: 'cafe',
        distance_meters: 5,
        facility_confidence: 80
      },
      result: { score: 82.4, label: 'Sangat Baik' }
    },
    candidate: {
      place_id: 'nearest',
      status: 'ranked'
    }
  }
} = {}) => {
  jest.resetModules();

  const transaction = {
    LOCK: { UPDATE: 'UPDATE' },
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined)
  };
  const mockBookingFindOne = jest.fn().mockResolvedValue(null);
  const mockBookingCreate = jest.fn(async (payload) => ({
    booking_id: 30,
    ...payload
  }));
  const mockLocationFindOne = jest.fn().mockResolvedValue(null);
  const mockLocationCreate = jest.fn().mockResolvedValue({
    location_id: 20,
    latitude: -0.9,
    longitude: 119.87,
    radius: 150,
    description: 'Lokasi klien'
  });
  const mockUserFindByPk = jest.fn().mockResolvedValue({ id_users: 9 });
  const mockReadWfaRequestConfig = jest.fn().mockResolvedValue({ radiusMeters: 150, reasons: [] });
  const mockResolveActiveWfaRequestReason = jest.fn().mockResolvedValue({
    reason: { id: 1, label: 'Pertemuan dengan klien', is_other: false },
    normalizedOtherReason: null
  });
  const mockAssertWfaEligibility = jest.fn().mockResolvedValue('2026-08-20');
  const mockScoreBookingLocation = jest.fn().mockResolvedValue(scoreResult);
  const mockTransaction = jest.fn().mockResolvedValue(transaction);

  jest.unstable_mockModule('../src/config/database.js', () => ({
    default: {
      transaction: mockTransaction,
      fn: jest.fn(),
      col: jest.fn()
    }
  }));
  jest.unstable_mockModule('../src/models/index.js', () => ({
    Booking: { findOne: mockBookingFindOne, create: mockBookingCreate },
    Location: {
      findOne: mockLocationFindOne,
      create: mockLocationCreate
    },
    BookingStatus: {},
    User: { findByPk: mockUserFindByPk },
    Position: {},
    Role: {},
    WfaRequestReason: {},
    WfaRejectionReason: {}
  }));
  jest.unstable_mockModule('../src/services/wfaSettings.service.js', () => ({
    readWfaRequestConfig: mockReadWfaRequestConfig,
    resolveActiveWfaRequestReason: mockResolveActiveWfaRequestReason,
    resolveActiveWfaRejectionReason: jest.fn()
  }));
  jest.unstable_mockModule('../src/services/wfaEligibility.service.js', () => ({
    assertWfaEligibility: mockAssertWfaEligibility
  }));
  jest.unstable_mockModule('../src/services/wfaRecommendation.service.js', () => ({
    scoreBookingLocation: mockScoreBookingLocation
  }));
  jest.unstable_mockModule('../src/modules/booking/bookingManagementRead.service.js', () => ({
    listManagementBookings: jest.fn()
  }));
  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }
  }));

  const { createBooking } = await import('../src/controllers/booking.controller.js');

  return {
    createBooking,
    transaction,
    scoreResult,
    mocks: {
      mockBookingCreate,
      mockReadWfaRequestConfig,
      mockResolveActiveWfaRequestReason,
      mockAssertWfaEligibility,
      mockScoreBookingLocation
    }
  };
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
      methodology
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
        fahp_methodology: methodology
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

describe('createBooking snapshot persistence', () => {
  it('persists the server-authored scoring snapshot and never accepts a client-authored one', async () => {
    const { createBooking, transaction, scoreResult, mocks } = await loadBookingController();
    const res = buildRes();
    const next = jest.fn();
    const clientSnapshot = { schema_version: 999, forged: true };

    await createBooking(
      {
        user: { id: 9 },
        body: {
          schedule_date: '2026-08-20',
          request_reason_id: 1,
          request_other_reason: null,
          latitude: -0.9,
          longitude: 119.87,
          description: 'Lokasi klien',
          notes: '  Pertemuan project  ',
          wfa_scoring_snapshot: clientSnapshot
        }
      },
      res,
      next
    );

    expect(mocks.mockAssertWfaEligibility).toHaveBeenCalledWith({
      userId: 9,
      scheduleDate: '2026-08-20',
      checkDuplicate: true
    });
    expect(mocks.mockScoreBookingLocation).toHaveBeenCalledWith({
      userId: 9,
      latitude: -0.9,
      longitude: 119.87,
      scheduleDate: '2026-08-20'
    });
    expect(mocks.mockBookingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 9,
        notes: 'Pertemuan project',
        suitability_score: 82.4,
        suitability_label: 'Sangat Baik',
        wfa_scoring_snapshot: scoreResult.scoringSnapshot
      }),
      { transaction }
    );
    expect(mocks.mockBookingCreate.mock.calls[0][0].wfa_scoring_snapshot).not.toBe(clientSnapshot);
    expect(res.json.mock.calls[0][0].data).not.toHaveProperty('wfa_scoring_snapshot');
    expect(transaction.commit).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('persists a null scoring snapshot when booking evidence is insufficient', async () => {
    const { createBooking, transaction, mocks } = await loadBookingController({
      scoreResult: {
        status: 'insufficient_facility_data',
        suitabilityScore: null,
        suitabilityLabel: null,
        scoringSnapshot: null,
        candidate: null
      }
    });
    const res = buildRes();

    await createBooking(
      {
        user: { id: 9 },
        body: {
          schedule_date: '2026-08-20',
          request_reason_id: 1,
          request_other_reason: null,
          latitude: -0.9,
          longitude: 119.87,
          description: 'Lokasi klien',
          notes: '  Pertemuan project  '
        }
      },
      res,
      jest.fn()
    );

    expect(mocks.mockBookingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        suitability_score: null,
        suitability_label: null,
        wfa_scoring_snapshot: null
      }),
      { transaction }
    );
    expect(res.json.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        suitability_score: null,
        suitability_label: null,
        suitability_status: 'insufficient_facility_data'
      })
    );
    expect(transaction.commit).toHaveBeenCalled();
  });
});
