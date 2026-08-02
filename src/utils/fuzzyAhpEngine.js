import logger from './logger.js';
import { defuzzifyMatrixTFN, computeCR } from '../analytics/fahp.js';
import { extentWeightsTFN } from '../analytics/fahp.extent.js';
import { minMax } from '../analytics/normalization.js';
import { labelEqualInterval } from '../analytics/labeling.js';
import {
  FACILITY_CRITERIA,
  FACILITY_PAIRWISE_TFN,
  WFA_PAIRWISE_TFN,
  DISC_PAIRWISE_TFN,
  SMART_AC_PAIRWISE_TFN
} from '../analytics/config.fahp.js';

// Simple memoization for FAHP weights
let cachedWfaWeights = null;
let cachedFacilityWeights = null;
let cachedDiscWeights = null;
let cachedSmartAcWeights = null;
let cachedWfaCR = null;
let cachedFacilityCR = null;
let cachedDiscCR = null;
let cachedSmartAcConsistency = null;

const CR_THRESHOLD = 0.10;
function selectWeights(matrixTFN) {
  return extentWeightsTFN(matrixTFN);
}

const selectWfaWeights = () => {
  const extentWeights = selectWeights(WFA_PAIRWISE_TFN);
  if (extentWeights.every((weight) => weight > 0)) return extentWeights;

  // Chang's possibility comparison can collapse a valid lowest-ranked criterion
  // to zero. Preserve the configured TFN judgments while using the standard
  // row-geometric-mean AHP derivation to retain all three scoring signals.
  const geometricMeans = defuzzifyMatrixTFN(WFA_PAIRWISE_TFN).map((row) =>
    Math.pow(row.reduce((product, value) => product * value, 1), 1 / row.length)
  );
  const sum = geometricMeans.reduce((total, value) => total + value, 0);
  return geometricMeans.map((value) => value / sum);
};

// --- Time utilities for Smart Auto Checkout weighted prediction ---
function minutesSinceMidnightWIB(dateLike) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(dateLike));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return Number(values.hour) * 60 + Number(values.minute);
}

function clampCheckout(targetDate, candidate, timeIn, endBoundaryStr) {
  if (!candidate) return null;
  const end = new Date(`${targetDate}T${endBoundaryStr || '18:00:00'}+07:00`);
  const tIn = new Date(timeIn);
  let final = new Date(Math.max(candidate.getTime(), tIn.getTime()));
  if (final.getTime() > end.getTime()) final = end;
  const finalDateStr = final.toISOString().split('T')[0];
  if (finalDateStr !== targetDate) return end;
  return final;
}

// --- Public utility: weightedPrediction for Smart Auto Checkout ---
function weightedPrediction(candidates, weights, targetDate, timeIn, fallbackEndStr) {
  const order = ['HIST', 'CHECKIN', 'CONTEXT', 'TRANSITION'];
  const available = order.filter((k) => candidates[k]);
  if (available.length === 0) return null;
  const idx = { HIST: 0, CHECKIN: 1, CONTEXT: 2, TRANSITION: 3 };
  const w = available.map((k) => weights[idx[k]]);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  const wn = w.map((x) => x / sum);
  const mins = available.map((k) => minutesSinceMidnightWIB(candidates[k]));
  const predMin = mins.reduce((acc, m, i) => acc + wn[i] * m, 0);
  const hh = String(Math.floor(predMin / 60)).padStart(2, '0');
  const mm = String(Math.floor(predMin % 60)).padStart(2, '0');
  const checkout = new Date(`${targetDate}T${hh}:${mm}:00+07:00`);
  return clampCheckout(targetDate, checkout, timeIn, fallbackEndStr);
}

// --- Public API: getWfaAhpWeights (now returns FAHP weights) ---
function getWfaAhpWeights() {
  if (cachedWfaWeights && cachedWfaCR != null) {
    return {
      location_type: cachedWfaWeights[0],
      distance_factor: cachedWfaWeights[1],
      facility_score: cachedWfaWeights[2],
      consistency_ratio: cachedWfaCR
    };
  }
  const weights = selectWfaWeights();
  const crisp = defuzzifyMatrixTFN(WFA_PAIRWISE_TFN);
  const { CR } = computeCR(crisp);
  cachedWfaWeights = weights;
  cachedWfaCR = CR;
  return {
    location_type: weights[0],
    distance_factor: weights[1],
    facility_score: weights[2],
    consistency_ratio: CR
  };
}

function getFacilityAhpWeights() {
  if (!cachedFacilityWeights || cachedFacilityCR == null) {
    cachedFacilityWeights = selectWeights(FACILITY_PAIRWISE_TFN);
    const { CR } = computeCR(defuzzifyMatrixTFN(FACILITY_PAIRWISE_TFN));
    cachedFacilityCR = Math.abs(CR) < Number.EPSILON ? 0 : CR;
  }

  return {
    criteria: [...FACILITY_CRITERIA],
    values: [...cachedFacilityWeights],
    consistency_ratio: cachedFacilityCR
  };
}

const parseScore = (value, fieldName) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be numeric`);
  }
  if (value < 0 || value > 100) {
    throw new Error(`${fieldName} must be between 0 and 100`);
  }
  return value;
};

const categoryTokens = (categories = []) =>
  categories.flatMap((category) =>
    String(category)
      .toLowerCase()
      .split(/[._-]/)
      .filter(Boolean)
  );

function getLocationTypeScore(place) {
  const categories = Array.isArray(place?.properties?.categories) ? place.properties.categories : [];
  const tokens = categoryTokens(categories);
  const name = String(place?.properties?.name || '').toLowerCase();
  const isCafe =
    categories.some((category) => String(category).includes('cafe') || String(category).includes('coffee')) ||
    name.includes('cafe') ||
    name.includes('coffee');
  const isLibrary =
    categories.some((category) => String(category).includes('library')) ||
    name.includes('library') ||
    name.includes('perpustakaan');
  const isHotel =
    categories.some((category) => String(category).includes('hotel') || String(category).includes('accommodation')) ||
    name.includes('hotel');
  const isRestaurant =
    categories.some((category) => String(category).includes('restaurant') || String(category).includes('food')) ||
    name.includes('restaurant') ||
    name.includes('restoran');
  const isLowSuitability =
    tokens.some((token) => ['industrial', 'warehouse', 'factory', 'manufacturing', 'storage', 'yard'].includes(token)) ||
    name.includes('industrial') ||
    name.includes('warehouse') ||
    name.includes('factory') ||
    name.includes('manufacturing') ||
    name.includes('storage');

  if (isLowSuitability) return 10;
  if (isCafe) return 100;
  if (isLibrary) return 85;
  if (isHotel) return 75;
  if (isRestaurant) return 65;
  if (categories.some((category) => String(category).includes('mall'))) return 60;
  if (categories.some((category) => String(category).includes('park'))) return 45;
  return 40;
}

function getDistanceFactorScore(distanceMeters) {
  if (typeof distanceMeters !== 'number' || !Number.isFinite(distanceMeters)) {
    throw new Error('distance must be numeric');
  }
  return minMax(distanceMeters, 0, 3000, 'cost') * 100;
}

async function calculateWfaScore(input, ahpWeights = null) {
  const components = input || {};
  const locationTypeScore = parseScore(components.locationTypeScore, 'location_type');
  const distanceScore = parseScore(components.distanceScore, 'distance_factor');
  const facilityScore = parseScore(components.facilityScore, 'facility_score');
  const wObj = ahpWeights || getWfaAhpWeights();
  const W = [wObj.location_type, wObj.distance_factor, wObj.facility_score];
  const score01 = W.reduce((sum, weight, index) => sum + weight * [locationTypeScore, distanceScore, facilityScore][index] / 100, 0);
  const result = {
    score: +(score01 * 100).toFixed(2),
    label: labelEqualInterval(score01),
    breakdown: {
      location_type: locationTypeScore,
      distance_factor: distanceScore,
      facility_score: facilityScore
    },
    weights: W,
    CR: +wObj.consistency_ratio?.toFixed?.(3) || undefined
  };

  if (result.CR != null && result.CR > CR_THRESHOLD) {
    result.warning = `AHP consistency ratio high (CR=${result.CR}). Consider revising pairwise judgments.`;
  }

  return result;
}

// --- Public API: getDisciplineAhpWeights (now FAHP) ---
function getDisciplineAhpWeights() {
  if (cachedDiscWeights && cachedDiscCR != null) {
    return {
      alpha_rate: cachedDiscWeights[0],
      lateness_severity: cachedDiscWeights[1],
      lateness_frequency: cachedDiscWeights[2],
      work_focus: cachedDiscWeights[3],
      consistency_ratio: cachedDiscCR
    };
  }
  const weights = selectWeights(DISC_PAIRWISE_TFN);
  const crisp = defuzzifyMatrixTFN(DISC_PAIRWISE_TFN);
  const { CR } = computeCR(crisp);
  cachedDiscWeights = weights;
  cachedDiscCR = CR;
  return {
    alpha_rate: weights[0],
    lateness_severity: weights[1],
    lateness_frequency: weights[2],
    work_focus: weights[3],
    consistency_ratio: CR
  };
}

// --- Public API: getSmartAcAhpWeights (now FAHP) ---
function getSmartAcAhpWeights() {
  if (cachedSmartAcWeights && cachedSmartAcConsistency) {
    return {
      history: cachedSmartAcWeights[0],
      checkin_pattern: cachedSmartAcWeights[1],
      context: cachedSmartAcWeights[2],
      transition: cachedSmartAcWeights[3],
      consistency_ratio: cachedSmartAcConsistency.CR,
      consistency_index: cachedSmartAcConsistency.CI,
      lambda_max: cachedSmartAcConsistency.lambdaMax
    };
  }

  const weights = selectWeights(SMART_AC_PAIRWISE_TFN);
  const crisp = defuzzifyMatrixTFN(SMART_AC_PAIRWISE_TFN);
  const consistency = computeCR(crisp);
  cachedSmartAcWeights = weights;
  cachedSmartAcConsistency = consistency;

  return {
    history: weights[0],
    checkin_pattern: weights[1],
    context: weights[2],
    transition: weights[3],
    consistency_ratio: consistency.CR,
    consistency_index: consistency.CI,
    lambda_max: consistency.lambdaMax
  };
}

// --- Public API: calculateDisciplineIndex(metrics) ---
async function calculateDisciplineIndex(m) {
  try {
    const wObj = getDisciplineAhpWeights();
    const W = [wObj.alpha_rate, wObj.lateness_severity, wObj.lateness_frequency, wObj.work_focus];

    const r_alpha = minMax(m.alpha_rate ?? 0, 0, 100, 'cost');
    const r_sev = minMax(m.avg_lateness_minutes ?? 0, 0, 60, 'cost');
    const r_freq = minMax(m.lateness_frequency ?? 0, 0, 100, 'cost');
    const r_focus = minMax(m.work_hour_consistency ?? 75, 0, 100, 'benefit');

    const r = [r_alpha, r_sev, r_freq, r_focus];
    const score01 = W.reduce((s, wi, i) => s + wi * r[i], 0);
    const label = labelEqualInterval(score01);

    const result = {
      score: +(score01 * 100).toFixed(2),
      label,
      breakdown: {
        alpha_rate: m.alpha_rate ?? 0,
        avg_lateness_minutes: m.avg_lateness_minutes ?? 0,
        lateness_frequency: m.lateness_frequency ?? 0,
        work_hour_consistency: m.work_hour_consistency ?? 75
      },
      weights: W,
      CR: +wObj.consistency_ratio?.toFixed?.(3) || undefined
    };

    if (result.CR != null && result.CR > CR_THRESHOLD) {
      result.warning = `AHP consistency ratio high (CR=${result.CR}). Consider revising pairwise judgments.`;
    }

    return result;
  } catch (error) {
    logger.error('Error calculating Discipline Index (FAHP):', error);
    return { score: 50, label: 'Sedang', breakdown: { error: error.message } };
  }
}

// Utilities kept for controllers compatibility
function getWfaScoreLabel(score) {
  const s = Number(score);
  if (s >= 80) return 'Sangat Tinggi';
  if (s >= 60) return 'Tinggi';
  if (s >= 40) return 'Sedang';
  if (s >= 20) return 'Rendah';
  return 'Sangat Rendah';
}

function getDisciplineLabel(score) {
  return getWfaScoreLabel(score);
}

function categorizePlace(place) {
  const categories = place.properties?.categories || [];
  const name = (place.properties?.name || '').toLowerCase();
  if (
    categories.some((c) => c.includes('cafe') || c.includes('coffee')) ||
    name.includes('cafe') ||
    name.includes('coffee')
  )
    return 'cafe';
  if (
    categories.some((c) => c.includes('library')) ||
    name.includes('library') ||
    name.includes('perpustakaan')
  )
    return 'library';
  if (
    categories.some((c) => c.includes('hotel') || c.includes('accommodation')) ||
    name.includes('hotel')
  )
    return 'hotel';
  if (
    categories.some((c) => c.includes('restaurant') || c.includes('food')) ||
    name.includes('restaurant') ||
    name.includes('restoran')
  )
    return 'restaurant';
  return 'other';
}

function getCategoryDisplayName(category) {
  const map = {
    cafe: 'Cafe',
    library: 'Perpustakaan',
    hotel: 'Hotel',
    restaurant: 'Restaurant',
    other: 'Lainnya'
  };
  return map[category] || 'Tidak Diketahui';
}

export default {
  // Main functions
  calculateWfaScore,
  calculateDisciplineIndex,

  // Weights
  getWfaAhpWeights,
  getFacilityAhpWeights,
  getDisciplineAhpWeights,
  getSmartAcAhpWeights,

  // Utils
  getLocationTypeScore,
  getDistanceFactorScore,
  getWfaScoreLabel,
  getDisciplineLabel,
  categorizePlace,
  getCategoryDisplayName,
  weightedPrediction
};
