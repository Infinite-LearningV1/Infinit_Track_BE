import { invTFN } from './fahp.js';

/**
 * Triangular Fuzzy Numbers (TFN) based on Saaty's 1-9 scale
 *
 * Scale mapping:
 * 1 = Equal importance
 * 3 = Moderate importance
 * 5 = Strong importance
 * 7 = Very strong importance
 * 9 = Extreme importance
 * 2,4,6,8 = Intermediate values
 */
export const TFN = {
  EQUAL: [1, 1, 1], // 1: Equal importance
  WEAK: [1, 2, 3], // 2: Weak/slight importance (intermediate)
  MODERATE: [2, 3, 4], // 3: Moderate importance
  MODERATE_PLUS: [3, 4, 5], // 4: Moderate plus (intermediate)
  STRONG: [4, 5, 6], // 5: Strong importance
  STRONG_PLUS: [5, 6, 7], // 6: Strong plus (intermediate)
  VERY_STRONG: [6, 7, 8], // 7: Very strong importance
  VERY_VERY_STRONG: [7, 8, 9], // 8: Very very strong (intermediate)
  EXTREME: [8, 9, 9] // 9: Extreme importance
};

/**
 * WFA (Work From Anywhere) Pairwise Comparison Matrix
 * Criteria: [location_type, distance_factor, amenity_score]
 *
 * Judgment rationale:
 * - location_type > distance_factor: MODERATE (3) - Type of place matters more than exact distance
 * - location_type > amenity_score: STRONG (5) - Location type is key factor
 * - distance_factor > amenity_score: MODERATE (3) - Distance still matters more than amenities
 */
export const WFA_PAIRWISE_TFN = [
  [TFN.EQUAL, TFN.MODERATE, TFN.STRONG], // location_type (was M, H, VH → EQUAL, MODERATE, STRONG)
  [invTFN(TFN.MODERATE), TFN.EQUAL, TFN.MODERATE], // distance_factor (was 1/H, M, H → 1/MODERATE, EQUAL, MODERATE)
  [invTFN(TFN.STRONG), invTFN(TFN.MODERATE), TFN.EQUAL] // amenity_score (was 1/VH, 1/H, M → 1/STRONG, 1/MODERATE, EQUAL)
];

/**
 * Discipline Index Pairwise Comparison Matrix
 * Criteria: [alpha_rate, lateness_severity, lateness_frequency, work_focus]
 *
 * Judgment rationale:
 * - alpha_rate > lateness_severity: STRONG (5) - Being absent is worse than being late
 * - alpha_rate > lateness_frequency: STRONG (5) - Absence frequency is critical
 * - alpha_rate > work_focus: MODERATE (3) - Absence matters more than work consistency
 * - lateness_severity > work_focus: EQUAL (1) - Both equally important
 * - lateness_frequency > work_focus: EQUAL (1) - Both equally important
 * - lateness_severity > lateness_frequency: MODERATE (3) - How late matters more than how often
 */
export const DISC_PAIRWISE_TFN = [
  [TFN.EQUAL, TFN.STRONG, TFN.STRONG, TFN.MODERATE], // alpha_rate (was M, VH, VH, H)
  [invTFN(TFN.STRONG), TFN.EQUAL, TFN.MODERATE, TFN.EQUAL], // lateness_severity (was 1/VH, M, H, M)
  [invTFN(TFN.STRONG), invTFN(TFN.MODERATE), TFN.EQUAL, TFN.EQUAL], // lateness_frequency (was 1/VH, 1/H, M, M)
  [invTFN(TFN.MODERATE), invTFN(TFN.EQUAL), invTFN(TFN.EQUAL), TFN.EQUAL] // work_focus (was 1/H, 1/M, 1/M, M)
];

/**
 * Smart Auto Checkout Pairwise Comparison Matrix
 * Criteria: [HIST, CHECKIN, CONTEXT, TRANSITION]
 *
 * Judgment rationale (optimized for CR < 0.1):
 * - HIST > CHECKIN: WEAK (2) - Historical pattern slightly better than fixed 8h rule
 * - HIST > CONTEXT: WEAK (2) - Personal history slightly better than org average
 * - HIST = TRANSITION: EQUAL (1) - Both evidence-based, different sources
 * - CHECKIN > CONTEXT: WEAK (2) - Individual rule slightly better than org pattern
 * - CHECKIN = TRANSITION: EQUAL (1) - Both valid individual indicators
 * - CONTEXT < TRANSITION: WEAK (1/2) - Org pattern less specific than geofence event
 *
 * CR target: < 0.1 (10%)
 */
export const SMART_AC_PAIRWISE_TFN = [
  [TFN.EQUAL, TFN.WEAK, TFN.WEAK, TFN.EQUAL], // HIST
  [invTFN(TFN.WEAK), TFN.EQUAL, TFN.WEAK, invTFN(TFN.EQUAL)], // CHECKIN
  [invTFN(TFN.WEAK), invTFN(TFN.WEAK), TFN.EQUAL, invTFN(TFN.WEAK)], // CONTEXT
  [TFN.EQUAL, TFN.EQUAL, TFN.WEAK, TFN.EQUAL] // TRANSITION
];
