import { jest } from '@jest/globals';
import { Op } from 'sequelize';

import {
  buildWfaDashboardRanking,
  createWfaDashboardAnalysisService,
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

describe('WFA dashboard analysis service facade', () => {
  const weights = {
    location_type: 0.41,
    distance_factor: 0.34,
    facility_score: 0.25,
    consistency_ratio: 0.07,
    weighting_method: 'mocked-engine-method',
    version: METHODOLOGY_VERSION
  };

  const createService = ({
    rows = [],
    scoreResult = { score: 91.25, label: 'Sangat Tinggi' }
  } = {}) => {
    const bookingModel = {
      findAll: jest.fn().mockResolvedValue(rows)
    };
    const engine = {
      getWfaAhpWeights: jest.fn(() => weights),
      calculateWfaScore: jest.fn().mockResolvedValue(scoreResult)
    };
    const service = createWfaDashboardAnalysisService({
      Booking: bookingModel,
      fuzzyEngine: engine,
      distanceCalculator: distanceByLatitude
    });

    return { bookingModel, engine, service };
  };

  test('queries only Approved WFA bookings in the inclusive schedule-date range with required location', async () => {
    const { bookingModel, service } = createService();

    await service.buildAnalysis({ from: '2026-08-01', to: '2026-08-15' });

    expect(bookingModel.findAll).toHaveBeenCalledWith({
      where: {
        status: 1,
        schedule_date: { [Op.between]: ['2026-08-01', '2026-08-15'] }
      },
      include: [
        {
          association: 'location',
          required: true
        }
      ]
    });
  });

  test('returns empty state with zeroed evidence and no fabricated ranking when no Approved bookings exist', async () => {
    const { service } = createService({ rows: [] });

    const result = await service.buildAnalysis({ from: '2026-08-01', to: '2026-08-15' });

    expect(result.status).toBe('empty');
    expect(result.ranking_preview).toEqual({ top_n: 5, items: [] });
    expect(result.evidence).toEqual({
      approved_booking_count: 0,
      analyzable_booking_count: 0,
      excluded_missing_snapshot_count: 0,
      excluded_incompatible_snapshot_count: 0,
      unique_location_count: 0,
      ranked_location_count: 0
    });
  });

  test('returns needs_data when Approved bookings have no compatible snapshots', async () => {
    const rows = [
      row({ bookingId: 'legacy', description: 'Legacy Cafe', scoringSnapshot: null }),
      row({
        bookingId: 'old-method',
        description: 'Old Method Cafe',
        latitude: 100,
        scoringSnapshot: snapshot({ version: 'wfa_fahp_v0' })
      })
    ];
    const { engine, service } = createService({ rows });

    const result = await service.buildAnalysis({ from: '2026-08-01', to: '2026-08-15' });

    expect(engine.calculateWfaScore).not.toHaveBeenCalled();
    expect(result.status).toBe('needs_data');
    expect(result.ranking_preview.items).toEqual([]);
    expect(result.evidence).toEqual({
      approved_booking_count: 2,
      analyzable_booking_count: 0,
      excluded_missing_snapshot_count: 1,
      excluded_incompatible_snapshot_count: 1,
      unique_location_count: 2,
      ranked_location_count: 0
    });
  });

  test('returns ready state, exact evidence counters, and keeps partial valid evidence analyzable', async () => {
    const rows = [
      row({
        bookingId: 'valid-a',
        description: 'Cafe Merdeka',
        latitude: 0,
        scoringSnapshot: snapshot({ locationType: 80, distance: 60, facility: 90 })
      }),
      row({
        bookingId: 'missing-same-cluster',
        description: 'Cafe Merdeka',
        latitude: 1,
        scoringSnapshot: null
      }),
      row({
        bookingId: 'valid-b',
        description: 'Library',
        latitude: 100,
        scoringSnapshot: snapshot({ locationType: 70, distance: 65, facility: 75 })
      }),
      row({
        bookingId: 'old-method',
        description: 'Old Method Cafe',
        latitude: 200,
        scoringSnapshot: snapshot({ version: 'wfa_fahp_v0' })
      })
    ];
    const { service } = createService({ rows });

    const result = await service.buildAnalysis({ from: '2026-08-01', to: '2026-08-15' });

    expect(result.status).toBe('ready');
    expect(result.evidence).toEqual({
      approved_booking_count: 4,
      analyzable_booking_count: 2,
      excluded_missing_snapshot_count: 1,
      excluded_incompatible_snapshot_count: 1,
      unique_location_count: 3,
      ranked_location_count: 2
    });
    expect(result.ranking_preview.items).toHaveLength(2);
    expect(result.ranking_preview.items[0]).toEqual(
      expect.objectContaining({
        location_label: expect.any(String),
        approved_booking_count: expect.any(Number),
        analyzable_booking_count: expect.any(Number)
      })
    );
  });

  test('returns criteria weights, consistency, and methodology exclusively from the engine weights', async () => {
    const rows = [
      row({
        bookingId: 'snapshot-with-different-method-metadata',
        scoringSnapshot: {
          ...snapshot(),
          methodology: {
            weights: {
              location_type: 0.99,
              distance_factor: 0,
              facility_score: 0.01
            },
            consistency_ratio: 0.99,
            weighting_method: 'snapshot-method'
          }
        }
      })
    ];
    const { engine, service } = createService({ rows });

    const result = await service.buildAnalysis({ from: '2026-08-01', to: '2026-08-15' });

    expect(engine.getWfaAhpWeights).toHaveBeenCalledTimes(1);
    expect(result.criteria_weights).toEqual([
      { key: 'location_type', display_label: 'Tipe Lokasi', value: 0.41 },
      { key: 'distance_factor', display_label: 'Faktor Jarak', value: 0.34 },
      { key: 'facility_score', display_label: 'Skor Fasilitas', value: 0.25 }
    ]);
    expect(result.consistency).toEqual({
      CR: 0.07,
      threshold: 0.1,
      is_consistent: true,
      summary_label: 'Konsistensi dapat diterima'
    });
    expect(result.methodology).toEqual({
      version: METHODOLOGY_VERSION,
      weighting_method: 'mocked-engine-method'
    });
  });
});
