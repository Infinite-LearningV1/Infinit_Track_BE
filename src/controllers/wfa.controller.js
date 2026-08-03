import logger from '../utils/logger.js';
import fuzzyEngine from '../utils/fuzzyAhpEngine.js';
import { recommendForUser } from '../services/wfaRecommendation.service.js';

/**
 * Get WFA recommendations for the authenticated user.
 * The recommendation service owns provider access, eligibility, enrichment,
 * facility evidence, scoring, and ranking.
 */
export const getWfaRecommendations = async (req, res, next) => {
  try {
    const data = await recommendForUser({
      userId: req.user.id,
      latitude: Number(req.query.lat),
      longitude: Number(req.query.lng),
      scheduleDate: req.query.schedule_date
    });

    return res.status(200).json({
      success: true,
      data: {
        recommendations: data.candidates,
        search_criteria: data.searchCriteria,
        fahp_methodology: data.methodology
      },
      message: 'Rekomendasi WFA berhasil diambil.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current Fuzzy AHP configuration for WFA recommendations.
 */
export const getWfaAhpConfig = async (_req, res, next) => {
  try {
    const ahpWeights = fuzzyEngine.getWfaAhpWeights();
    return res.status(200).json({
      success: true,
      data: {
        current_weights: {
          location_type: ahpWeights.location_type,
          facility_score: ahpWeights.facility_score,
          distance_factor: ahpWeights.distance_factor
        },
        consistency_ratio: ahpWeights.consistency_ratio,
        is_consistent: ahpWeights.consistency_ratio <= 0.1,
        method:
          ahpWeights.weighting_method === 'row_geometric_mean_fallback'
            ? 'Fuzzy AHP dengan fallback geometric mean'
            : 'Fuzzy AHP dengan Chang Extent Analysis',
        criteria_explanation: {
          location_type:
            'Penilaian berdasarkan kategori tempat (cafe, hotel, coworking space, dll)',
          facility_score:
            'Penilaian berdasarkan internet_access, air_conditioning, toilets, opening_hours, dan wheelchair accessibility.',
          distance_factor: 'Penilaian berdasarkan jarak dari pusat pencarian'
        },
        weight_calculation:
          ahpWeights.weighting_method === 'row_geometric_mean_fallback'
            ? 'Pembobotan pairwise TFN dengan row geometric mean fallback karena Chang menghasilkan bobot nol'
            : 'Pembobotan kriteria berbasis pairwise TFN dengan Chang Extent Analysis',
        scoring_method: 'Weighted scoring model dengan normalisasi 0-100'
      },
      message: 'Konfigurasi Fuzzy AHP Engine berhasil diambil'
    });
  } catch (error) {
    logger.error(`Error getting AHP config: ${error.message}`);
    next(error);
  }
};

/**
 * Test canonical Fuzzy AHP scoring with explicit facility evidence.
 * Admin endpoint for internal testing and debugging.
 */
export const testFuzzyAhp = async (req, res, next) => {
  try {
    const { place_data, custom_weights, scenario, expected } = req.body;
    const properties = place_data?.properties ?? {};

    if (!place_data) {
      return res.status(400).json({
        success: false,
        message: 'Parameter place_data wajib diisi untuk testing'
      });
    }

    if (
      Object.hasOwn(properties, 'amenity_score') ||
      (custom_weights &&
        typeof custom_weights === 'object' &&
        Object.hasOwn(custom_weights, 'amenity_score')) ||
      !Number.isFinite(properties.facility_score)
    ) {
      return res.status(400).json({
        success: false,
        code: 'E_VALIDATION',
        message: 'facility_score wajib berupa angka untuk testing'
      });
    }

    const usesCustomWeights = custom_weights != null;
    const weights = usesCustomWeights ? custom_weights : fuzzyEngine.getWfaAhpWeights();
    const testResult = await fuzzyEngine.calculateWfaScore(
      {
        locationTypeScore: fuzzyEngine.getLocationTypeScore(place_data),
        distanceScore: fuzzyEngine.getDistanceFactorScore(properties.distance),
        facilityScore: properties.facility_score
      },
      weights
    );
    const category = testResult.label;
    const normalizedExpected = typeof expected === 'string' ? expected.trim() : null;

    return res.status(200).json({
      success: true,
      data: {
        scenario: scenario || properties.name || 'WFA Test',
        weights: {
          location_type: Number((weights.location_type ?? testResult.weights?.[0] ?? 0).toFixed(4)),
          distance_factor: Number((weights.distance_factor ?? testResult.weights?.[1] ?? 0).toFixed(4)),
          facility_score: Number((weights.facility_score ?? testResult.weights?.[2] ?? 0).toFixed(4))
        },
        cr: usesCustomWeights
          ? null
          : testResult.CR ?? Number((weights.consistency_ratio ?? 0).toFixed(3)),
        score: testResult.score,
        category,
        expected: normalizedExpected,
        match: normalizedExpected ? category === normalizedExpected : false
      },
      message: 'Test Fuzzy AHP berhasil'
    });
  } catch (error) {
    logger.error(`Error testing Fuzzy AHP: ${error.message}`);
    next(error);
  }
};
