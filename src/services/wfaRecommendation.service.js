import Settings from '../models/settings.model.js';
import { AppError } from '../shared/errors/AppError.js';
import { calculateDistance } from '../utils/geofence.js';
import fuzzyEngine from '../utils/fuzzyAhpEngine.js';
import { assertWfaEligibility } from './wfaEligibility.service.js';
import {
  createGeoapifyWfaClient,
  GEOAPIFY_WFA_CATEGORIES,
  mapWithConcurrency
} from './geoapifyWfa.client.js';
import { readStrictWfaCheckinWindow, scoreFacilityEvidence } from './wfaFacility.service.js';

const DEFAULT_SEARCH_RADIUS_METERS = 5000;
const DETAILS_CONCURRENCY = 5;
const FACILITY_KEYS = Object.freeze([
  'internet_access',
  'air_conditioning',
  'toilets',
  'opening_hours',
  'wheelchair_accessibility'
]);
const STATUS_ORDER = Object.freeze({
  ranked: 0,
  insufficient_facility_data: 1,
  facility_enrichment_failed: 2
});

const readSearchRadius = async () => {
  const setting = await Settings.findOne({
    where: { setting_key: 'wfa.recommendation.search_radius' }
  });
  const radius = Number.parseInt(setting?.setting_value, 10);

  return Number.isInteger(radius) && radius > 0 ? radius : DEFAULT_SEARCH_RADIUS_METERS;
};

const defaults = {
  geoapifyClient: createGeoapifyWfaClient(),
  eligibility: { assertWfaEligibility },
  facility: { readStrictWfaCheckinWindow, scoreFacilityEvidence },
  fuzzyEngine,
  calculateDistance,
  readSearchRadius
};

const compareStableId = (left, right) => {
  if (left.placeId < right.placeId) return -1;
  if (left.placeId > right.placeId) return 1;
  return 0;
};

const compareDistanceAndId = (left, right) =>
  left.distanceMeters - right.distanceMeters || compareStableId(left, right);

const isFiniteScoreDomain = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

const emptyFacilities = () =>
  Object.fromEntries(FACILITY_KEYS.map((key) => [key, null]));

const normalizeFacilities = (facilities = {}) => ({
  ...emptyFacilities(),
  ...Object.fromEntries(FACILITY_KEYS.map((key) => [key, facilities[key] ?? null]))
});

const isValidCoordinate = (latitude, longitude) =>
  typeof latitude === 'number' &&
  Number.isFinite(latitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  typeof longitude === 'number' &&
  Number.isFinite(longitude) &&
  longitude >= -180 &&
  longitude <= 180;

const candidateIdentity = (feature) => {
  const placeId = feature?.properties?.place_id;
  return typeof placeId === 'string' && placeId.trim() ? placeId.trim() : null;
};

const candidateCoordinates = (feature) => {
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  const [longitude, latitude] = coordinates;
  return isValidCoordinate(latitude, longitude) ? { latitude, longitude } : null;
};

const candidateFallbackKey = (feature, { latitude, longitude }) => {
  const placeName =
    typeof feature.properties?.name === 'string' && feature.properties.name
      ? feature.properties.name.trim()
      : 'unknown';
  const normalizedName = placeName
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
  const coordinateKey = `${Math.round(latitude * 10000)},${Math.round(longitude * 10000)}`;

  return `${normalizedName}|${coordinateKey}`;
};

const candidateName = (feature) => {
  const name = feature.properties?.name || feature.properties?.address_line1;
  return typeof name === 'string' && name.trim() ? name.trim() : 'Tempat Tidak Diketahui';
};

const candidateAddress = (feature) => {
  const address = feature.properties?.formatted || feature.properties?.address_line2;
  return typeof address === 'string' && address.trim() ? address.trim() : null;
};

const scoringUnavailableError = () =>
  new AppError('Penilaian lokasi WFA sedang tidak tersedia.', {
    code: 'WFA_SCORING_UNAVAILABLE',
    status: 503
  });

const publicCandidate = (candidate, {
  status,
  facilityScore,
  facilityConfidence,
  facilities,
  finalScore,
  finalLabel,
  rank = null
}, extra = {}) => ({
  place_id: candidate.placeId,
  name: candidate.name,
  address: candidate.address,
  latitude: candidate.latitude,
  longitude: candidate.longitude,
  status,
  distance_meters: candidate.distanceMeters,
  location_type: candidate.locationType,
  facility_score: facilityScore,
  facility_confidence: facilityConfidence,
  facilities,
  final_score: finalScore,
  final_label: finalLabel,
  rank,
  ...extra
});

const recommendationSearchCriteria = ({
  latitude,
  longitude,
  radiusMeters,
  totalCandidatesFound,
  recommendationsReturned
}) => ({
  center_latitude: latitude,
  center_longitude: longitude,
  search_radius_meters: radiusMeters,
  categories_searched: GEOAPIFY_WFA_CATEGORIES.split(','),
  total_candidates_found: totalCandidatesFound,
  recommendations_returned: recommendationsReturned
});

const recommendationMethodology = (wfaWeights, facilityWeights) => ({
  approach: 'Fuzzy AHP facility-evidence scoring',
  criteria_weights: {
    location_type: wfaWeights.location_type,
    distance_factor: wfaWeights.distance_factor,
    facility_score: wfaWeights.facility_score,
    consistency_ratio: wfaWeights.consistency_ratio
  },
  facility_matrix: {
    version: facilityWeights.version,
    criteria: [...facilityWeights.criteria],
    weights: [...facilityWeights.values],
    consistency_ratio: facilityWeights.consistency_ratio,
    weighting_method: facilityWeights.weighting_method
  }
});

const buildScoringSnapshot = ({ candidate, evidence, wfaWeights, final }) => {
  const criteria = {
    location_type_score: candidate.locationTypeScore,
    distance_factor_score: candidate.distanceScore,
    facility_score: evidence.facilityScore
  };

  if (Object.values(criteria).some((value) => !isFiniteScoreDomain(value))) {
    return null;
  }

  return {
    schema_version: 1,
    methodology_version: wfaWeights.version,
    captured_at: new Date().toISOString(),
    criteria,
    methodology: {
      weights: {
        location_type: wfaWeights.location_type,
        distance_factor: wfaWeights.distance_factor,
        facility_score: wfaWeights.facility_score
      },
      consistency_ratio: wfaWeights.consistency_ratio,
      weighting_method: wfaWeights.weighting_method
    },
    evidence: {
      place_id: candidate.placeId,
      location_type: candidate.locationType,
      distance_meters: candidate.distanceMeters,
      facility_confidence: evidence.facilityConfidence
    },
    result: {
      score: final.score,
      label: final.label
    }
  };
};

const compareFinalCandidates = (left, right) => {
  const statusDifference = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
  if (statusDifference) return statusDifference;

  if (left.status === 'ranked') {
    return (
      right.final_score - left.final_score ||
      left.distance_meters - right.distance_meters ||
      (left.place_id < right.place_id ? -1 : left.place_id > right.place_id ? 1 : 0)
    );
  }

  if (left.status === 'insufficient_facility_data') {
    return (
      right.facility_confidence - left.facility_confidence ||
      left.distance_meters - right.distance_meters ||
      (left.place_id < right.place_id ? -1 : left.place_id > right.place_id ? 1 : 0)
    );
  }

  return (
    left.distance_meters - right.distance_meters ||
    (left.place_id < right.place_id ? -1 : left.place_id > right.place_id ? 1 : 0)
  );
};

export const createWfaRecommendationService = (dependencies = {}) => {
  const resolved = { ...defaults, ...dependencies };

  const prepareCandidates = ({ features, latitude, longitude, wfaWeights }) => {
    const seenPlaceIds = new Set();
    const seenFallbackKeys = new Set();
    const denominator = wfaWeights.location_type + wfaWeights.distance_factor;

    return features.flatMap((feature) => {
      const placeId = candidateIdentity(feature);
      const coordinates = candidateCoordinates(feature);
      if (!placeId || !coordinates) return [];

      const fallbackKey = candidateFallbackKey(feature, coordinates);
      if (seenPlaceIds.has(placeId) || seenFallbackKeys.has(fallbackKey)) return [];

      const distanceMeters = resolved.calculateDistance(
        latitude,
        longitude,
        coordinates.latitude,
        coordinates.longitude
      );
      if (typeof distanceMeters !== 'number' || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
        return [];
      }

      seenPlaceIds.add(placeId);
      seenFallbackKeys.add(fallbackKey);
      const locationTypeScore = resolved.fuzzyEngine.getLocationTypeScore(feature);
      const distanceScore = resolved.fuzzyEngine.getDistanceFactorScore(distanceMeters);
      const preliminaryScore =
        locationTypeScore * (wfaWeights.location_type / denominator) +
        distanceScore * (wfaWeights.distance_factor / denominator);

      return [{
        feature,
        placeId,
        name: candidateName(feature),
        address: candidateAddress(feature),
        ...coordinates,
        distanceMeters,
        locationType: resolved.fuzzyEngine.categorizePlace(feature),
        locationTypeScore,
        distanceScore,
        preliminaryScore
      }];
    });
  };

  const enrichCandidate = async ({
    candidate,
    scheduleDate,
    checkinWindow,
    wfaWeights,
    includeScoringSnapshot = false
  }) => {
    let details;
    try {
      details = await resolved.geoapifyClient.fetchPlaceDetails(candidate.placeId);
    } catch (_error) {
      return publicCandidate(candidate, {
        status: 'facility_enrichment_failed',
        facilityScore: null,
        facilityConfidence: null,
        facilities: emptyFacilities(),
        finalScore: null,
        finalLabel: null
      }, includeScoringSnapshot ? { scoringSnapshot: null } : undefined);
    }

    const evidence = resolved.facility.scoreFacilityEvidence({
      detailsProperties: details?.properties ?? {},
      scheduleDate,
      checkinWindow
    });
    const facilities = normalizeFacilities(evidence.facilities);

    if (evidence.knownFields < 2 || !Number.isFinite(evidence.facilityScore)) {
      return publicCandidate(candidate, {
        status: 'insufficient_facility_data',
        facilityScore: Number.isFinite(evidence.facilityScore) ? evidence.facilityScore : null,
        facilityConfidence: evidence.facilityConfidence,
        facilities,
        finalScore: null,
        finalLabel: null
      }, includeScoringSnapshot ? { scoringSnapshot: null } : undefined);
    }

    const final = await resolved.fuzzyEngine.calculateWfaScore(
      {
        locationTypeScore: candidate.locationTypeScore,
        distanceScore: candidate.distanceScore,
        facilityScore: evidence.facilityScore
      },
      wfaWeights
    );

    return publicCandidate(candidate, {
      status: 'ranked',
      facilityScore: evidence.facilityScore,
      facilityConfidence: evidence.facilityConfidence,
      facilities,
      finalScore: final.score,
      finalLabel: final.label
    }, includeScoringSnapshot
      ? {
          scoringSnapshot: buildScoringSnapshot({
            candidate,
            evidence,
            wfaWeights,
            final
          })
        }
      : undefined);
  };

  const runPipeline = async ({
    latitude,
    longitude,
    scheduleDate,
    radiusMeters,
    candidateLimit,
    nearestOnly = false,
    includeScoringSnapshot = false
  }) => {
    const features = await resolved.geoapifyClient.searchPlaces({
      latitude,
      longitude,
      radiusMeters
    });
    const wfaWeights = resolved.fuzzyEngine.getWfaAhpWeights();
    const facilityWeights = resolved.fuzzyEngine.getFacilityAhpWeights();
    const candidates = prepareCandidates({ features, latitude, longitude, wfaWeights });
    const methodology = recommendationMethodology(wfaWeights, facilityWeights);
    const shortlist = candidates
      .sort(
        nearestOnly
          ? compareDistanceAndId
          : (left, right) =>
              right.preliminaryScore - left.preliminaryScore || compareDistanceAndId(left, right)
      )
      .slice(0, candidateLimit);

    if (!shortlist.length) {
      return {
        candidates: [],
        searchCriteria: recommendationSearchCriteria({
          latitude,
          longitude,
          radiusMeters,
          totalCandidatesFound: features.length,
          recommendationsReturned: 0
        }),
        methodology
      };
    }

    const checkinWindow = await resolved.facility.readStrictWfaCheckinWindow();
    const enriched = await mapWithConcurrency(shortlist, DETAILS_CONCURRENCY, (candidate) =>
      enrichCandidate({ candidate, scheduleDate, checkinWindow, wfaWeights, includeScoringSnapshot })
    );
    let rank = 0;
    const ranked = enriched.sort(compareFinalCandidates).map((candidate) => ({
      ...candidate,
      rank: candidate.status === 'ranked' ? (rank += 1) : null
    }));

    return {
      candidates: ranked,
      searchCriteria: recommendationSearchCriteria({
        latitude,
        longitude,
        radiusMeters,
        totalCandidatesFound: features.length,
        recommendationsReturned: ranked.length
      }),
      methodology
    };
  };

  const recommendForUser = async ({ userId, latitude, longitude, scheduleDate }) => {
    const eligibleDate = await resolved.eligibility.assertWfaEligibility({
      userId,
      scheduleDate,
      checkDuplicate: true
    });
    const radiusMeters = await resolved.readSearchRadius();

    return runPipeline({
      latitude,
      longitude,
      scheduleDate: eligibleDate,
      radiusMeters,
      candidateLimit: 30
    });
  };

  const analyze = async ({
    latitude,
    longitude,
    scheduleDate,
    radiusMeters = DEFAULT_SEARCH_RADIUS_METERS
  }) => {
    const eligibleDate = await resolved.eligibility.assertWfaEligibility({
      userId: undefined,
      scheduleDate,
      checkDuplicate: false
    });

    return runPipeline({
      latitude,
      longitude,
      scheduleDate: eligibleDate,
      radiusMeters,
      candidateLimit: 30
    });
  };

  const scoreBookingLocation = async ({ userId, latitude, longitude, scheduleDate }) => {
    const eligibleDate = await resolved.eligibility.assertWfaEligibility({
      userId,
      scheduleDate,
      checkDuplicate: true
    });
    const radiusMeters = await resolved.readSearchRadius();
    let result;

    try {
      result = await runPipeline({
        latitude,
        longitude,
        scheduleDate: eligibleDate,
        radiusMeters,
        candidateLimit: 1,
        nearestOnly: true,
        includeScoringSnapshot: true
      });
    } catch (error) {
      if (error?.code === 'WFA_PROVIDER_UNAVAILABLE') {
        throw scoringUnavailableError();
      }
      throw error;
    }

    const candidate = result.candidates[0] ?? null;
    if (candidate?.status === 'facility_enrichment_failed') {
      throw scoringUnavailableError();
    }
    if (!candidate || candidate.status === 'insufficient_facility_data') {
      return {
        status: 'insufficient_facility_data',
        suitabilityScore: null,
        suitabilityLabel: null,
        scoringSnapshot: null,
        candidate
      };
    }

    const { scoringSnapshot = null, ...publicCandidateResult } = candidate;

    return {
      status: 'ranked',
      suitabilityScore: publicCandidateResult.final_score,
      suitabilityLabel: publicCandidateResult.final_label,
      scoringSnapshot,
      candidate: publicCandidateResult
    };
  };

  return { recommendForUser, analyze, scoreBookingLocation };
};

const recommendationService = createWfaRecommendationService();

export const { recommendForUser, analyze, scoreBookingLocation } = recommendationService;
