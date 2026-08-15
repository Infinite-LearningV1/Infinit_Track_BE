import { WFA_MATRIX_VERSION } from '../analytics/config.fahp.js';
import { calculateDistance } from '../utils/geofence.js';
import fuzzyEngine from '../utils/fuzzyAhpEngine.js';

const PHYSICAL_CLUSTER_RADIUS_METERS = 25;
const RANKING_LIMIT = 5;

const CRITERION_KEYS = [
  'location_type_score',
  'distance_factor_score',
  'facility_score'
];

const asFiniteNumber = (value) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const compareNullableText = (left, right) => {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left.localeCompare(right);
};

const compareValue = (left, right) => {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), undefined, { numeric: true });
};

export const normalizeWfaDashboardDescription = (value) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  return normalized === '' ? null : normalized;
};

const displayDescription = (value) => {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

  return normalized === '' ? null : normalized;
};

export const validateWfaScoringSnapshot = (snapshot, methodologyVersion) => {
  if (!snapshot) {
    return { valid: false, reason: 'MISSING_SNAPSHOT' };
  }

  if (snapshot.methodology_version !== methodologyVersion) {
    return { valid: false, reason: 'INCOMPATIBLE_METHODOLOGY' };
  }

  const criteria = snapshot.criteria;
  const parsedCriteria = {};

  if (!criteria || typeof criteria !== 'object') {
    return { valid: false, reason: 'INVALID_CRITERIA' };
  }

  for (const key of CRITERION_KEYS) {
    const value = criteria[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      return { valid: false, reason: 'INVALID_CRITERIA' };
    }
    parsedCriteria[key] = value;
  }

  return { valid: true, criteria: parsedCriteria };
};

const extractSnapshot = (row) => row?.wfa_scoring_snapshot ?? row?.wfaScoringSnapshot ?? row?.snapshot ?? null;

const extractLocation = (row) => row?.location ?? row?.Location ?? {};

const normalizeRow = (row, methodologyVersion) => {
  const location = extractLocation(row);
  const description =
    row?.description ??
    row?.location_description ??
    row?.locationDescription ??
    location.description ??
    location.location_description ??
    location.name ??
    null;
  const latitude = asFiniteNumber(row?.latitude ?? row?.lat ?? location.latitude ?? location.lat);
  const longitude = asFiniteNumber(
    row?.longitude ?? row?.lng ?? row?.lon ?? location.longitude ?? location.lng ?? location.lon
  );
  const snapshot = extractSnapshot(row);
  const snapshotValidation = validateWfaScoringSnapshot(snapshot, methodologyVersion);

  return {
    bookingId: row?.bookingId ?? row?.booking_id ?? row?.id ?? null,
    locationId: row?.locationId ?? row?.location_id ?? location.location_id ?? location.id ?? null,
    description: displayDescription(description),
    normalizedDescription: normalizeWfaDashboardDescription(description),
    latitude,
    longitude,
    snapshot,
    snapshotValidation,
    criteria: snapshotValidation.valid ? snapshotValidation.criteria : null,
    originalRow: row
  };
};

const compareRowsForClustering = (left, right) =>
  compareNullableText(left.normalizedDescription, right.normalizedDescription) ||
  compareValue(left.latitude, right.latitude) ||
  compareValue(left.longitude, right.longitude) ||
  compareValue(left.locationId, right.locationId) ||
  compareValue(left.bookingId, right.bookingId);

const rowDistanceFromAnchor = (row, anchor, distanceCalculator) => {
  if (
    row.latitude == null ||
    row.longitude == null ||
    anchor.latitude == null ||
    anchor.longitude == null
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return distanceCalculator(anchor.latitude, anchor.longitude, row.latitude, row.longitude);
};

const isCompatibleWithCluster = (row, cluster, distanceCalculator) => {
  const anchor = cluster.anchor;
  const hasDescriptionPair = row.normalizedDescription != null && anchor.normalizedDescription != null;

  if (hasDescriptionPair && row.normalizedDescription !== anchor.normalizedDescription) {
    return false;
  }

  return rowDistanceFromAnchor(row, anchor, distanceCalculator) <= PHYSICAL_CLUSTER_RADIUS_METERS;
};

const createCluster = (row) => ({
  anchor: row,
  normalizedDescription: row.normalizedDescription,
  description: row.description,
  location_label: row.description ?? `Location ${row.locationId ?? row.bookingId ?? 'Unknown'}`,
  latitude: row.latitude,
  longitude: row.longitude,
  rows: [row]
});

export const clusterWfaDashboardRows = (
  rows,
  {
    distanceCalculator = calculateDistance,
    methodologyVersion = WFA_MATRIX_VERSION
  } = {}
) => {
  const normalizedRows = [...(rows ?? [])]
    .map((row) => normalizeRow(row, methodologyVersion))
    .sort(compareRowsForClustering);
  const clusters = [];

  for (const row of normalizedRows) {
    const compatibleCluster = clusters.find((cluster) =>
      isCompatibleWithCluster(row, cluster, distanceCalculator)
    );

    if (compatibleCluster) {
      compatibleCluster.rows.push(row);
    } else {
      clusters.push(createCluster(row));
    }
  }

  return clusters;
};

const average = (values) => values.reduce((total, value) => total + value, 0) / values.length;

const averageCriteria = (rows) => ({
  location_type_score: average(rows.map((row) => row.criteria.location_type_score)),
  distance_factor_score: average(rows.map((row) => row.criteria.distance_factor_score)),
  facility_score: average(rows.map((row) => row.criteria.facility_score))
});

const normalizeClusterRowForRanking = (row, methodologyVersion) => {
  const normalized =
    row?.bookingId !== undefined && row?.snapshotValidation
      ? { ...row }
      : normalizeRow(row, methodologyVersion);
  const snapshotValidation = validateWfaScoringSnapshot(normalized.snapshot, methodologyVersion);

  return {
    ...normalized,
    snapshotValidation,
    criteria: snapshotValidation.valid ? snapshotValidation.criteria : null
  };
};

const compareRankedLocations = (left, right) =>
  right.score - left.score ||
  right.analyzable_booking_count - left.analyzable_booking_count ||
  right.approved_booking_count - left.approved_booking_count ||
  left.location_label.localeCompare(right.location_label);

export const buildWfaDashboardRanking = async (
  clusters,
  {
    weights = fuzzyEngine.getWfaAhpWeights(),
    scoreCalculator = fuzzyEngine.calculateWfaScore
  } = {}
) => {
  const methodologyVersion = weights.version ?? WFA_MATRIX_VERSION;
  const ranked = [];

  for (const cluster of clusters ?? []) {
    const rows = (cluster.rows ?? []).map((row) => normalizeClusterRowForRanking(row, methodologyVersion));
    const analyzableRows = rows.filter((row) => row.snapshotValidation.valid);

    if (analyzableRows.length === 0) {
      continue;
    }

    const criteriaSummary = averageCriteria(analyzableRows);
    const result = await scoreCalculator(
      {
        locationTypeScore: criteriaSummary.location_type_score,
        distanceScore: criteriaSummary.distance_factor_score,
        facilityScore: criteriaSummary.facility_score
      },
      weights
    );

    ranked.push({
      location_label: cluster.location_label ?? cluster.description ?? 'Unknown WFA Location',
      score: result.score,
      label: result.label,
      latitude: cluster.latitude,
      longitude: cluster.longitude,
      criteria_summary: criteriaSummary,
      approved_booking_count: rows.length,
      analyzable_booking_count: analyzableRows.length
    });
  }

  return ranked.sort(compareRankedLocations).slice(0, RANKING_LIMIT);
};
