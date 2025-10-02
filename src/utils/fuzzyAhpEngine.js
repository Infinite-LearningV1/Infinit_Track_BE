import logger from './logger.js';
import { defuzzifyMatrixTFN, computeCR } from '../analytics/fahp.js';
import { extentWeightsTFN } from '../analytics/fahp.extent.js';
import { minMax } from '../analytics/normalization.js';
import { labelEqualInterval } from '../analytics/labeling.js';
import { WFA_PAIRWISE_TFN, DISC_PAIRWISE_TFN } from '../analytics/config.fahp.js';
import { calculateDistance, toJakartaTime } from './geofence.js';

// Simple memoization for FAHP weights
let cachedWfaWeights = null;
let cachedDiscWeights = null;
let cachedWfaCR = null;
let cachedDiscCR = null;

const CR_THRESHOLD = parseFloat(process.env.AHP_CR_THRESHOLD || '0.10');
function selectWeights(matrixTFN) {
  return extentWeightsTFN(matrixTFN);
}

// --- Time utilities for Smart Auto Checkout weighted prediction ---
function minutesSinceMidnightWIB(dateLike) {
  const j = toJakartaTime(dateLike);
  return j.getHours() * 60 + j.getMinutes();
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
      amenity_score: cachedWfaWeights[2],
      consistency_ratio: cachedWfaCR
    };
  }
  const weights = selectWeights(WFA_PAIRWISE_TFN);
  const crisp = defuzzifyMatrixTFN(WFA_PAIRWISE_TFN);
  const { CR } = computeCR(crisp);
  cachedWfaWeights = weights;
  cachedWfaCR = CR;
  return {
    location_type: weights[0],
    distance_factor: weights[1],
    amenity_score: weights[2],
    consistency_ratio: CR
  };
}

// --- Public API: calculateWfaScore(place, ahpWeights?) ---
async function calculateWfaScore(placeDetails, ahpWeights = null) {
  try {
    const wObj = ahpWeights || getWfaAhpWeights();
    const W = [wObj.location_type, wObj.distance_factor, wObj.amenity_score];

    // r_loc: map simple categories to [0,1]
    const categories = placeDetails.properties?.categories || [];
    const name = (placeDetails.properties?.name || '').toLowerCase();
    const isCafe =
      categories.some((c) => c.includes('cafe') || c.includes('coffee')) ||
      name.includes('cafe') ||
      name.includes('coffee');
    const isLibrary =
      categories.some((c) => c.includes('library')) ||
      name.includes('library') ||
      name.includes('perpustakaan');
    const isHotel =
      categories.some((c) => c.includes('hotel') || c.includes('accommodation')) ||
      name.includes('hotel');
    const isRestaurant =
      categories.some((c) => c.includes('restaurant') || c.includes('food')) ||
      name.includes('restaurant') ||
      name.includes('restoran');

    let loc01 = 0.4;
    if (isCafe) loc01 = 1.0;
    else if (isLibrary) loc01 = 0.85;
    else if (isHotel) loc01 = 0.75;
    else if (isRestaurant) loc01 = 0.65;
    else if (categories.some((c) => c.includes('mall'))) loc01 = 0.6;
    else if (categories.some((c) => c.includes('park'))) loc01 = 0.45;

    // Distance fallback: use provided properties.distance or compute from coordinates
    let distanceMeters = placeDetails.properties?.distance;
    try {
      if (distanceMeters == null) {
        const user = placeDetails.userLocation;
        const coords = placeDetails.geometry?.coordinates;
        if (user && Array.isArray(coords) && coords.length >= 2) {
          const lat2 = coords[1];
          const lon2 = coords[0];
          distanceMeters = calculateDistance(user.lat, user.lon, lat2, lon2);
        }
      }
    } catch (e) {
      logger.debug(`Distance fallback failed: ${e.message}`);
    }
    if (distanceMeters == null || Number.isNaN(distanceMeters)) distanceMeters = 1000;
    const r_dist = minMax(distanceMeters, 0, 3000, 'cost');

    // Amenity score: expect 0..100 if provided; fallback simple inference
    let amen = 50;
    if (placeDetails.properties?.amenity_score != null) {
      amen = Number(placeDetails.properties.amenity_score);
    }
    const r_amen = Math.max(0, Math.min(1, amen / 100));

    const r = [loc01, r_dist, r_amen];
    const score01 = W.reduce((s, wi, i) => s + wi * r[i], 0);
    const label = labelEqualInterval(score01);

    const result = {
      score: +(score01 * 100).toFixed(2),
      label,
      breakdown: {
        location_score: +(loc01 * 100).toFixed(2),
        distance_score: +(r_dist * 100).toFixed(2),
        amenity_score: +(r_amen * 100).toFixed(2)
      },
      weights: W,
      CR: +wObj.consistency_ratio?.toFixed?.(3) || undefined
    };

    if (result.CR != null && result.CR > CR_THRESHOLD) {
      result.warning = `AHP consistency ratio high (CR=${result.CR}). Consider revising pairwise judgments.`;
    }

    return result;
  } catch (error) {
    logger.error('Error calculating WFA score (FAHP):', error);
    return { score: 50, label: 'Sedang', breakdown: { error: error.message } };
  }
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
  getDisciplineAhpWeights,

  // Utils
  getWfaScoreLabel,
  getDisciplineLabel,
  categorizePlace,
  getCategoryDisplayName,
  weightedPrediction
};
