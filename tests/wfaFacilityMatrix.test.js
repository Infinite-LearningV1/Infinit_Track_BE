import fuzzyEngine from '../src/utils/fuzzyAhpEngine.js';

test('facility matrix produces equal weights and CR zero', () => {
  const result = fuzzyEngine.getFacilityAhpWeights();

  expect(result.criteria).toEqual([
    'internet_access',
    'air_conditioning',
    'toilets',
    'opening_hours',
    'wheelchair_accessibility'
  ]);
  expect(result.values).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
  expect(result.consistency_ratio).toBe(0);
});

test('facility weights are returned as copies', () => {
  const first = fuzzyEngine.getFacilityAhpWeights();
  first.criteria[0] = 'changed';
  first.values[0] = 99;

  expect(fuzzyEngine.getFacilityAhpWeights()).toEqual({
    criteria: ['internet_access', 'air_conditioning', 'toilets', 'opening_hours', 'wheelchair_accessibility'],
    values: [0.2, 0.2, 0.2, 0.2, 0.2],
    consistency_ratio: 0
  });
});

test('main WFA score requires facility_score and exposes renamed breakdown', async () => {
  const result = await fuzzyEngine.calculateWfaScore({
    locationTypeScore: 100,
    distanceScore: 80,
    facilityScore: 60
  });

  expect(result.breakdown).toEqual({
    location_type: 100,
    distance_factor: 80,
    facility_score: 60
  });
  expect(result.breakdown).not.toHaveProperty('amenity_score');
});

test('main WFA score rejects missing facility evidence', async () => {
  await expect(fuzzyEngine.calculateWfaScore({ locationTypeScore: 100, distanceScore: 80 })).rejects.toThrow(
    'facility_score must be numeric'
  );
});

test('higher facility evidence increases the main WFA score', async () => {
  const lowFacility = await fuzzyEngine.calculateWfaScore({
    locationTypeScore: 60,
    distanceScore: 60,
    facilityScore: 0
  });
  const highFacility = await fuzzyEngine.calculateWfaScore({
    locationTypeScore: 60,
    distanceScore: 60,
    facilityScore: 100
  });

  expect(highFacility.score).toBeGreaterThan(lowFacility.score);
});

test('main WFA weights disclose the non-zero fallback method', () => {
  const weights = fuzzyEngine.getWfaAhpWeights();

  expect(weights.weighting_method).toBe('row_geometric_mean_fallback');
  expect(weights.location_type).toBeCloseTo(0.633524839963704, 12);
  expect(weights.distance_factor).toBeCloseTo(0.2604011016177943, 12);
  expect(weights.facility_score).toBeCloseTo(0.10607405841850168, 12);
});

test('main WFA score does not accept legacy place payloads', async () => {
  await expect(
    fuzzyEngine.calculateWfaScore({
      properties: { name: 'Coffee Lab', categories: ['cafe'], distance: 200, amenity_score: 90 }
    })
  ).rejects.toThrow('location_type must be numeric');
});

test('legacy amenity compatibility keeps missing evidence in the legacy breakdown', async () => {
  const result = await fuzzyEngine.calculateLegacyWfaAmenityScore({
    properties: { name: 'Coffee Lab', categories: ['cafe'], distance: 200 }
  });

  expect(result.breakdown).toEqual({
    location_score: 100,
    distance_score: expect.any(Number),
    amenity_score: 50
  });
  expect(result.breakdown).not.toHaveProperty('facility_score');
});
