import { jest } from '@jest/globals';

import { AppError } from '../src/shared/errors/AppError.js';
import { createWfaRecommendationService } from '../src/services/wfaRecommendation.service.js';

const scheduleDate = '2099-08-03';
const unknownFacilities = Object.freeze({
  internet_access: null,
  air_conditioning: null,
  toilets: null,
  opening_hours: null,
  wheelchair_accessibility: null
});
const rankedFacility = Object.freeze({
  facilities: {
    internet_access: 1,
    air_conditioning: 1,
    toilets: 1,
    opening_hours: 0,
    wheelchair_accessibility: null
  },
  knownFields: 4,
  facilityConfidence: 80,
  facilityScore: 75,
  facilityCr: 0
});

const place = ({
  id,
  distance = 0,
  locationScore = 80,
  name = id,
  address = `${id} address`,
  latitude = 0,
  longitude = distance,
  locationType = 'cafe'
}) => ({
  type: 'Feature',
  properties: {
    place_id: id,
    name,
    formatted: address,
    categories: [`catering.${locationType}`],
    location_score: locationScore,
    location_type: locationType
  },
  geometry: { type: 'Point', coordinates: [longitude, latitude] }
});

const detailsFor = (facilityResult = rankedFacility) => ({
  type: 'Feature',
  properties: {
    feature_type: 'details',
    internet_access: 'yes',
    air_conditioning: 'yes',
    facilityResult
  }
});

const createHarness = ({
  features = [],
  details = {},
  searchError = null,
  wfaWeights = {
    location_type: 0.5,
    distance_factor: 0.3,
    facility_score: 0.2,
    consistency_ratio: 0
  },
  calculateWfaScore = null,
  fetchPlaceDetails = null,
  readStrictWfaCheckinWindow = null
} = {}) => {
  const geoapifyClient = {
    searchPlaces: jest.fn(
      searchError
        ? () => Promise.reject(searchError)
        : () => Promise.resolve(features)
    ),
    fetchPlaceDetails:
      fetchPlaceDetails ||
      jest.fn((placeId) => {
        const value = details[placeId];
        if (value instanceof Error) return Promise.reject(value);
        return Promise.resolve(value ?? detailsFor());
      })
  };
  const eligibility = {
    assertWfaEligibility: jest.fn(({ scheduleDate: value }) => Promise.resolve(value))
  };
  const facility = {
    readStrictWfaCheckinWindow:
      readStrictWfaCheckinWindow ||
      jest.fn().mockResolvedValue({ startTime: '08:00:00', endTime: '17:00:00' }),
    scoreFacilityEvidence: jest.fn(({ detailsProperties }) =>
      detailsProperties.facilityResult ?? {
        facilities: { ...unknownFacilities },
        knownFields: 0,
        facilityConfidence: 0,
        facilityScore: null,
        facilityCr: 0
      }
    )
  };
  const fuzzyEngine = {
    getWfaAhpWeights: jest.fn(() => wfaWeights),
    getLocationTypeScore: jest.fn((candidate) => candidate.properties.location_score),
    getDistanceFactorScore: jest.fn((distance) => Math.max(0, 100 - distance)),
    categorizePlace: jest.fn((candidate) => candidate.properties.location_type),
    calculateWfaScore:
      calculateWfaScore ||
      jest.fn(({ facilityScore }) =>
        Promise.resolve({
          score: facilityScore === 75 ? 82.4 : facilityScore,
          label: facilityScore === 75 ? 'Sangat Baik' : 'Baik'
        })
      )
  };
  const calculateDistance = jest.fn((_originLat, _originLng, _candidateLat, candidateLng) =>
    Math.abs(candidateLng)
  );
  const readSearchRadius = jest.fn().mockResolvedValue(5000);
  const service = createWfaRecommendationService({
    geoapifyClient,
    eligibility,
    facility,
    fuzzyEngine,
    calculateDistance,
    readSearchRadius
  });

  return {
    service,
    geoapifyClient,
    eligibility,
    facility,
    fuzzyEngine,
    calculateDistance,
    readSearchRadius
  };
};

test('shortlists only the top 30 candidates before Place Details enrichment', async () => {
  const features = Array.from({ length: 35 }, (_, index) =>
    place({
      id: `place-${String(index).padStart(2, '0')}`,
      distance: index,
      locationScore: 100 - index
    })
  );
  const harness = createHarness({ features });

  const result = await harness.service.analyze({ latitude: 0, longitude: 0, scheduleDate });

  expect(harness.geoapifyClient.fetchPlaceDetails).toHaveBeenCalledTimes(30);
  expect(harness.geoapifyClient.fetchPlaceDetails.mock.calls.map(([id]) => id)).toEqual(
    features.slice(0, 30).map((candidate) => candidate.properties.place_id)
  );
  expect(result.candidates).toHaveLength(30);
  expect(result.candidates[0]).not.toHaveProperty('preliminary_score');
  expect(harness.fuzzyEngine.calculateWfaScore).toHaveBeenCalledWith(
    expect.objectContaining({ facilityScore: expect.any(Number) }),
    expect.anything()
  );
});

test('uses the renormalized location and distance weights before raw-distance and ID ties', async () => {
  const features = [
    place({ id: 'location-first', locationScore: 90, distance: 100 }),
    place({ id: 'weighted-first', locationScore: 89, distance: 0 }),
    place({ id: 'raw-far', locationScore: 100, distance: 100 }),
    place({ id: 'raw-near', locationScore: 80, distance: 20 }),
    place({ id: 'beta', locationScore: 70, distance: 30 }),
    place({ id: 'alpha', locationScore: 70, distance: 30 })
  ];
  const harness = createHarness({
    features,
    wfaWeights: {
      location_type: 0.8,
      distance_factor: 0.2,
      facility_score: 0,
      consistency_ratio: 0
    }
  });

  await harness.service.analyze({ latitude: 0, longitude: 0, scheduleDate });

  expect(harness.geoapifyClient.fetchPlaceDetails.mock.calls.map(([id]) => id)).toEqual([
    'weighted-first',
    'raw-near',
    'raw-far',
    'location-first',
    'alpha',
    'beta'
  ]);
});

test('rejects invalid candidates, requires a stable place ID, and deduplicates by place ID', async () => {
  const duplicate = place({ id: 'valid-a', distance: 2 });
  const missingId = place({ id: undefined, distance: 3 });
  const blankId = place({ id: '   ', distance: 4 });
  const invalidLatitude = place({ id: 'bad-latitude', latitude: 91, distance: 5 });
  const invalidLongitude = place({ id: 'bad-longitude', longitude: 181, distance: 6 });
  const nonFiniteCoordinate = place({ id: 'bad-number', longitude: Number.NaN, distance: 7 });
  const harness = createHarness({
    features: [
      place({ id: 'valid-a', distance: 1 }),
      duplicate,
      missingId,
      blankId,
      invalidLatitude,
      invalidLongitude,
      nonFiniteCoordinate,
      { properties: { place_id: 'missing-geometry' } },
      place({ id: 'valid-b', distance: 8 })
    ]
  });

  const result = await harness.service.analyze({ latitude: 0, longitude: 0, scheduleDate });

  expect(harness.geoapifyClient.fetchPlaceDetails.mock.calls.map(([id]) => id)).toEqual([
    'valid-a',
    'valid-b'
  ]);
  expect(result.candidates.map(({ place_id: id }) => id)).toEqual(['valid-a', 'valid-b']);
});

test('deduplicates different place IDs by normalized name and rounded coordinates only', async () => {
  const harness = createHarness({
    features: [
      place({
        id: 'retained',
        name: '  Cafe   Baru!  ',
        latitude: 2.000041,
        longitude: 1.000041
      }),
      place({
        id: 'duplicate-provider-id',
        name: 'cafe baru',
        latitude: 2.000049,
        longitude: 1.000049
      }),
      place({
        id: 'nearby-distinct-coordinate',
        name: 'Cafe Baru',
        latitude: 2.000051,
        longitude: 1.000051
      }),
      place({
        id: 'distinct-name',
        name: 'Cafe Lama',
        latitude: 2.000041,
        longitude: 1.000041
      })
    ]
  });

  const result = await harness.service.analyze({ latitude: 0, longitude: 0, scheduleDate });
  const enrichedIds = harness.geoapifyClient.fetchPlaceDetails.mock.calls.map(([id]) => id);

  expect(enrichedIds).toHaveLength(3);
  expect(enrichedIds).toContain('retained');
  expect(enrichedIds).not.toContain('duplicate-provider-id');
  expect(enrichedIds).toContain('nearby-distinct-coordinate');
  expect(enrichedIds).toContain('distinct-name');
  expect(result.candidates.map(({ place_id: id }) => id)).toEqual([
    'distinct-name',
    'retained',
    'nearby-distinct-coordinate'
  ]);
});

test('enriches candidate details with concurrency exactly five', async () => {
  const deferred = [];
  let active = 0;
  let maxActive = 0;
  const fetchPlaceDetails = jest.fn(() => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    return new Promise((resolve) => {
      deferred.push(() => {
        active -= 1;
        resolve(detailsFor());
      });
    });
  });
  const harness = createHarness({
    features: Array.from({ length: 7 }, (_, index) =>
      place({ id: `place-${index}`, distance: index })
    ),
    fetchPlaceDetails
  });

  const resultPromise = harness.service.analyze({ latitude: 0, longitude: 0, scheduleDate });
  for (let turn = 0; turn < 20 && deferred.length < 5; turn += 1) await Promise.resolve();

  expect(active).toBe(5);
  expect(maxActive).toBe(5);
  deferred.splice(0).forEach((resolve) => resolve());
  for (let turn = 0; turn < 20 && deferred.length < 2; turn += 1) await Promise.resolve();
  deferred.splice(0).forEach((resolve) => resolve());

  await expect(resultPromise).resolves.toMatchObject({ candidates: expect.any(Array) });
  expect(fetchPlaceDetails).toHaveBeenCalledTimes(7);
  expect(maxActive).toBe(5);
});

test('maps ranked, insufficient, and failed enrichment statuses without fallback scores', async () => {
  const insufficientFacility = {
    facilities: { ...unknownFacilities, internet_access: 1 },
    knownFields: 1,
    facilityConfidence: 20,
    facilityScore: 100,
    facilityCr: 0
  };
  const harness = createHarness({
    features: [
      place({ id: 'failed', distance: 3 }),
      place({ id: 'insufficient', distance: 2 }),
      place({ id: 'ranked', distance: 1 })
    ],
    details: {
      failed: new Error('details failed'),
      insufficient: detailsFor(insufficientFacility),
      ranked: detailsFor(rankedFacility)
    }
  });

  const result = await harness.service.analyze({ latitude: 0, longitude: 0, scheduleDate });

  expect(result.candidates.map(({ place_id: id }) => id)).toEqual([
    'ranked',
    'insufficient',
    'failed'
  ]);
  expect(result.candidates).toEqual([
    expect.objectContaining({
      place_id: 'ranked',
      status: 'ranked',
      facility_score: 75,
      facility_confidence: 80,
      facilities: rankedFacility.facilities,
      final_score: 82.4,
      final_label: 'Sangat Baik',
      rank: 1
    }),
    expect.objectContaining({
      place_id: 'insufficient',
      status: 'insufficient_facility_data',
      facility_score: 100,
      facility_confidence: 20,
      facilities: insufficientFacility.facilities,
      final_score: null,
      final_label: null,
      rank: null
    }),
    expect.objectContaining({
      place_id: 'failed',
      status: 'facility_enrichment_failed',
      facility_score: null,
      facility_confidence: null,
      facilities: unknownFacilities,
      final_score: null,
      final_label: null,
      rank: null
    })
  ]);
  expect(harness.fuzzyEngine.calculateWfaScore).toHaveBeenCalledTimes(1);
});

test('orders equal final scores by distance and then stable place ID', async () => {
  const equalScore = jest.fn().mockResolvedValue({ score: 70, label: 'Baik' });
  const harness = createHarness({
    features: [
      place({ id: 'far', distance: 20 }),
      place({ id: 'beta', distance: 10 }),
      place({ id: 'alpha', distance: 10 })
    ],
    calculateWfaScore: equalScore
  });

  const result = await harness.service.analyze({ latitude: 0, longitude: 0, scheduleDate });

  expect(result.candidates.map(({ place_id: id }) => id)).toEqual(['alpha', 'beta', 'far']);
  expect(result.candidates.map(({ rank }) => rank)).toEqual([1, 2, 3]);
});

test('recommendations require duplicate eligibility and the configured search radius', async () => {
  const harness = createHarness();

  await harness.service.recommendForUser({
    userId: 41,
    latitude: -0.8917,
    longitude: 119.8707,
    scheduleDate
  });

  expect(harness.eligibility.assertWfaEligibility).toHaveBeenCalledWith({
    userId: 41,
    scheduleDate,
    checkDuplicate: true
  });
  expect(harness.readSearchRadius).toHaveBeenCalledTimes(1);
  expect(harness.geoapifyClient.searchPlaces).toHaveBeenCalledWith({
    latitude: -0.8917,
    longitude: 119.8707,
    radiusMeters: 5000
  });
});

test('analysis validates the date without a duplicate check and honors its explicit radius', async () => {
  const harness = createHarness();

  await harness.service.analyze({
    latitude: -0.8917,
    longitude: 119.8707,
    scheduleDate,
    radiusMeters: 2500
  });

  expect(harness.eligibility.assertWfaEligibility).toHaveBeenCalledWith({
    userId: undefined,
    scheduleDate,
    checkDuplicate: false
  });
  expect(harness.readSearchRadius).not.toHaveBeenCalled();
  expect(harness.geoapifyClient.searchPlaces).toHaveBeenCalledWith({
    latitude: -0.8917,
    longitude: 119.8707,
    radiusMeters: 2500
  });
});

test('booking scoring selects the nearest valid candidate and returns canonical ranked fields', async () => {
  const harness = createHarness({
    features: [
      place({ id: 'preliminary-best', distance: 90, locationScore: 100 }),
      place({ id: 'nearest', distance: 5, locationScore: 40 })
    ]
  });

  const result = await harness.service.scoreBookingLocation({
    userId: 41,
    latitude: 0,
    longitude: 0,
    scheduleDate
  });

  expect(harness.eligibility.assertWfaEligibility).toHaveBeenCalledWith({
    userId: 41,
    scheduleDate,
    checkDuplicate: true
  });
  expect(harness.geoapifyClient.fetchPlaceDetails).toHaveBeenCalledTimes(1);
  expect(harness.geoapifyClient.fetchPlaceDetails).toHaveBeenCalledWith('nearest');
  expect(result).toEqual({
    status: 'ranked',
    suitabilityScore: 82.4,
    suitabilityLabel: 'Sangat Baik',
    candidate: expect.objectContaining({ place_id: 'nearest', status: 'ranked' })
  });
});

test('booking scoring returns nullable suitability when discovery has no candidate or evidence is insufficient', async () => {
  const emptyHarness = createHarness();
  await expect(
    emptyHarness.service.scoreBookingLocation({
      userId: 41,
      latitude: 0,
      longitude: 0,
      scheduleDate
    })
  ).resolves.toEqual({
    status: 'insufficient_facility_data',
    suitabilityScore: null,
    suitabilityLabel: null,
    candidate: null
  });

  const insufficientFacility = {
    facilities: { ...unknownFacilities, internet_access: 1 },
    knownFields: 1,
    facilityConfidence: 20,
    facilityScore: 100,
    facilityCr: 0
  };
  const insufficientHarness = createHarness({
    features: [place({ id: 'insufficient', distance: 1 })],
    details: { insufficient: detailsFor(insufficientFacility) }
  });

  await expect(
    insufficientHarness.service.scoreBookingLocation({
      userId: 41,
      latitude: 0,
      longitude: 0,
      scheduleDate
    })
  ).resolves.toEqual({
    status: 'insufficient_facility_data',
    suitabilityScore: null,
    suitabilityLabel: null,
    candidate: expect.objectContaining({
      place_id: 'insufficient',
      facility_score: 100,
      final_score: null
    })
  });
});

test.each([
  ['discovery', { searchError: new AppError('provider unavailable', { code: 'WFA_PROVIDER_UNAVAILABLE', status: 503 }) }],
  [
    'selected Place Details enrichment',
    {
      features: [place({ id: 'failed', distance: 1 })],
      details: { failed: new Error('details failed') }
    }
  ]
])('booking translates %s failure to WFA_SCORING_UNAVAILABLE', async (_case, options) => {
  const harness = createHarness(options);

  await expect(
    harness.service.scoreBookingLocation({
      userId: 41,
      latitude: 0,
      longitude: 0,
      scheduleDate
    })
  ).rejects.toMatchObject({
    name: 'AppError',
    code: 'WFA_SCORING_UNAVAILABLE',
    status: 503
  });
});

test('does not translate strict WFA configuration failures', async () => {
  const configError = new AppError('config unavailable', {
    code: 'WFA_CONFIG_UNAVAILABLE',
    status: 500
  });
  const harness = createHarness({
    features: [place({ id: 'candidate', distance: 1 })],
    readStrictWfaCheckinWindow: jest.fn().mockRejectedValue(configError)
  });

  await expect(
    harness.service.scoreBookingLocation({
      userId: 41,
      latitude: 0,
      longitude: 0,
      scheduleDate
    })
  ).rejects.toBe(configError);
});
