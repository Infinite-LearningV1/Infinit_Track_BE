import { jest } from '@jest/globals';

import {
  buildWfaDashboardRanking,
  clusterWfaDashboardRows,
  normalizeWfaDashboardDescription,
  validateWfaScoringSnapshot
} from '../src/services/wfaDashboardAnalysis.service.js';

const METHODOLOGY_VERSION = 'wfa_fahp_v1';

const snapshot = ({
  version = METHODOLOGY_VERSION,
  locationType = 80,
  distance = 70,
  facility = 90
} = {}) => ({
  schema_version: 1,
  methodology_version: version,
  criteria: {
    location_type_score: locationType,
    distance_factor_score: distance,
    facility_score: facility
  }
});

const row = ({
  bookingId,
  locationId = bookingId,
  description = 'Cafe Merdeka',
  latitude = 0,
  longitude = 0,
  scoringSnapshot = snapshot()
}) => ({
  booking_id: bookingId,
  location_id: locationId,
  description,
  latitude,
  longitude,
  wfa_scoring_snapshot: scoringSnapshot
});

const distanceByLatitude = (latA, _lonA, latB) => Math.abs(latA - latB);

const clusterBookingIds = (clusters) =>
  clusters.map((cluster) => cluster.rows.map((item) => item.bookingId));

describe('WFA dashboard snapshot validation', () => {
  test('normalizes descriptions with trimming, lower-casing, whitespace collapse, and blank-to-null behavior', () => {
    expect(normalizeWfaDashboardDescription('  Cafe   Merdeka \n Palu  ')).toBe('cafe merdeka palu');
    expect(normalizeWfaDashboardDescription('   ')).toBeNull();
    expect(normalizeWfaDashboardDescription(null)).toBeNull();
  });

  test('accepts matching finite criteria in the 0..100 range', () => {
    expect(validateWfaScoringSnapshot(snapshot(), METHODOLOGY_VERSION)).toEqual({
      valid: true,
      criteria: {
        location_type_score: 80,
        distance_factor_score: 70,
        facility_score: 90
      }
    });
  });

  test.each([
    ['missing snapshot', null, 'MISSING_SNAPSHOT'],
    ['incompatible methodology', snapshot({ version: 'wfa_fahp_v0' }), 'INCOMPATIBLE_METHODOLOGY'],
    ['non-finite criterion', snapshot({ locationType: Number.NaN }), 'INVALID_CRITERIA'],
    ['criterion above range', snapshot({ distance: 101 }), 'INVALID_CRITERIA'],
    ['criterion below range', snapshot({ facility: -1 }), 'INVALID_CRITERIA'],
    ['malformed criteria object', { methodology_version: METHODOLOGY_VERSION, criteria: null }, 'INVALID_CRITERIA']
  ])('rejects %s with explicit reason code', (_caseName, value, reason) => {
    expect(validateWfaScoringSnapshot(value, METHODOLOGY_VERSION)).toEqual({
      valid: false,
      reason
    });
  });
});

describe('WFA dashboard physical clustering', () => {
  test('groups the same normalized nonblank description only inside the immutable anchor 25m boundary', () => {
    const clusters = clusterWfaDashboardRows(
      [
        row({ bookingId: 'near-anchor', description: '  Cafe   Merdeka ', latitude: 25 }),
        row({ bookingId: 'anchor', description: 'cafe merdeka', latitude: 0 }),
        row({ bookingId: 'beyond-anchor', description: 'CAFE MERDEKA', latitude: 25.01 })
      ],
      { distanceCalculator: distanceByLatitude }
    );

    expect(clusterBookingIds(clusters)).toEqual([
      ['anchor', 'near-anchor'],
      ['beyond-anchor']
    ]);
  });

  test('keeps different nonblank descriptions separate even when they are nearby', () => {
    const clusters = clusterWfaDashboardRows(
      [
        row({ bookingId: 'library', description: 'Library', latitude: 0 }),
        row({ bookingId: 'cafe', description: 'Cafe', latitude: 1 })
      ],
      { distanceCalculator: distanceByLatitude }
    );

    expect(clusterBookingIds(clusters)).toEqual([['cafe'], ['library']]);
  });

  test('uses proximity fallback for blank descriptions', () => {
    const clusters = clusterWfaDashboardRows(
      [
        row({ bookingId: 'blank-near', description: ' ', latitude: 20 }),
        row({ bookingId: 'blank-anchor', description: null, latitude: 0 }),
        row({ bookingId: 'blank-far', description: '', latitude: 30 })
      ],
      { distanceCalculator: distanceByLatitude }
    );

    expect(clusterBookingIds(clusters)).toEqual([
      ['blank-anchor', 'blank-near'],
      ['blank-far']
    ]);
  });

  test('groups blank descriptions with a labeled anchor by proximity while keeping far blanks separate', () => {
    const clusters = clusterWfaDashboardRows(
      [
        row({ bookingId: 'blank-near-label', description: '', latitude: 20 }),
        row({ bookingId: 'labeled-anchor', description: 'Cafe Anchor', latitude: 0 }),
        row({ bookingId: 'blank-far-label', description: ' ', latitude: 30 })
      ],
      { distanceCalculator: distanceByLatitude }
    );

    expect(clusterBookingIds(clusters)).toEqual([
      ['labeled-anchor', 'blank-near-label'],
      ['blank-far-label']
    ]);
  });

  test('returns the same deterministic cluster membership when input order is reversed', () => {
    const rows = [
      row({ bookingId: 'cafe-b', description: 'Cafe Palu', latitude: 10 }),
      row({ bookingId: 'blank-a', description: '', latitude: 0 }),
      row({ bookingId: 'cafe-a', description: ' cafe   palu ', latitude: 0 }),
      row({ bookingId: 'library-a', description: 'Library', latitude: 0 })
    ];

    const forward = clusterBookingIds(
      clusterWfaDashboardRows(rows, { distanceCalculator: distanceByLatitude })
    );
    const reversed = clusterBookingIds(
      clusterWfaDashboardRows([...rows].reverse(), { distanceCalculator: distanceByLatitude })
    );

    expect(reversed).toEqual(forward);
    expect(forward).toEqual([['cafe-a', 'cafe-b', 'blank-a'], ['library-a']]);
  });

  test('does not transitively merge rows when the new row is more than 25m from the cluster anchor', () => {
    const clusters = clusterWfaDashboardRows(
      [
        row({ bookingId: 'a', description: 'Cafe Transit', latitude: 0 }),
        row({ bookingId: 'b', description: 'Cafe Transit', latitude: 20 }),
        row({ bookingId: 'c', description: 'Cafe Transit', latitude: 40 })
      ],
      { distanceCalculator: distanceByLatitude }
    );

    expect(clusterBookingIds(clusters)).toEqual([
      ['a', 'b'],
      ['c']
    ]);
  });
});

describe('WFA dashboard ranking aggregation', () => {
  test('averages valid criteria and calls the score calculator with canonical WFA arguments', async () => {
    const weights = {
      location_type: 0.5,
      distance_factor: 0.3,
      facility_score: 0.2,
      consistency_ratio: 0,
      weighting_method: 'row_geometric_mean_fallback',
      version: METHODOLOGY_VERSION
    };
    const scoreCalculator = jest.fn().mockResolvedValue({ score: 86.43, label: 'Sangat Tinggi' });
    const clusters = clusterWfaDashboardRows(
      [
        row({
          bookingId: 'a',
          locationId: 10,
          description: 'Cafe Merdeka',
          scoringSnapshot: snapshot({ locationType: 80, distance: 60, facility: 90 })
        }),
        row({
          bookingId: 'b',
          locationId: 10,
          description: 'Cafe Merdeka',
          scoringSnapshot: snapshot({ locationType: 100, distance: 80, facility: 70 })
        }),
        row({
          bookingId: 'legacy',
          locationId: 10,
          description: 'Cafe Merdeka',
          scoringSnapshot: null
        })
      ],
      { distanceCalculator: distanceByLatitude }
    );

    const ranking = await buildWfaDashboardRanking(clusters, { weights, scoreCalculator });

    expect(scoreCalculator).toHaveBeenCalledWith(
      {
        locationTypeScore: 90,
        distanceScore: 70,
        facilityScore: 80
      },
      weights
    );
    expect(ranking).toEqual([
      expect.objectContaining({
        location_label: 'Cafe Merdeka',
        score: 86.43,
        label: 'Sangat Tinggi',
        approved_booking_count: 3,
        analyzable_booking_count: 2,
        criteria_summary: {
          location_type_score: 90,
          distance_factor_score: 70,
          facility_score: 80
        }
      })
    ]);
  });

  test('sorts deterministically and returns only the top five ranked locations', async () => {
    const weights = {
      location_type: 0.5,
      distance_factor: 0.3,
      facility_score: 0.2,
      consistency_ratio: 0,
      weighting_method: 'row_geometric_mean_fallback',
      version: METHODOLOGY_VERSION
    };
    const scoresByLocationTypeScore = new Map([
      [10, { score: 90, label: 'Sangat Tinggi' }],
      [20, { score: 90, label: 'Sangat Tinggi' }],
      [30, { score: 90, label: 'Sangat Tinggi' }],
      [40, { score: 90, label: 'Sangat Tinggi' }],
      [50, { score: 88, label: 'Tinggi' }],
      [60, { score: 87, label: 'Tinggi' }]
    ]);
    const scoreCalculator = jest.fn(({ locationTypeScore }) =>
      Promise.resolve(scoresByLocationTypeScore.get(locationTypeScore))
    );
    const rows = [
      row({ bookingId: 'bravo-1', description: 'Bravo', latitude: 0, scoringSnapshot: snapshot({ locationType: 40 }) }),
      row({ bookingId: 'alpha-1', description: 'Alpha', latitude: 100, scoringSnapshot: snapshot({ locationType: 30 }) }),
      row({ bookingId: 'charlie-1', description: 'Charlie', latitude: 200, scoringSnapshot: snapshot({ locationType: 20 }) }),
      row({ bookingId: 'charlie-2', description: 'Charlie', latitude: 201, scoringSnapshot: snapshot({ locationType: 20 }) }),
      row({ bookingId: 'delta-1', description: 'Delta', latitude: 300, scoringSnapshot: snapshot({ locationType: 10 }) }),
      row({ bookingId: 'delta-2', description: 'Delta', latitude: 301, scoringSnapshot: snapshot({ locationType: 10 }) }),
      row({ bookingId: 'delta-legacy', description: 'Delta', latitude: 302, scoringSnapshot: null }),
      row({ bookingId: 'echo-1', description: 'Echo', latitude: 400, scoringSnapshot: snapshot({ locationType: 50 }) }),
      row({ bookingId: 'foxtrot-1', description: 'Foxtrot', latitude: 500, scoringSnapshot: snapshot({ locationType: 60 }) })
    ];
    const clusters = clusterWfaDashboardRows(rows, {
      distanceCalculator: distanceByLatitude,
      methodologyVersion: METHODOLOGY_VERSION
    });

    const ranking = await buildWfaDashboardRanking(clusters, { weights, scoreCalculator });

    expect(ranking.map((item) => item.location_label)).toEqual([
      'Delta',
      'Charlie',
      'Alpha',
      'Bravo',
      'Echo'
    ]);
    expect(ranking).toHaveLength(5);
  });
});
