import axios from 'axios';

import Settings from '../models/settings.model.js';
import logger from '../utils/logger.js';
import fuzzyEngine from '../utils/fuzzyAhpEngine.js';
import { calculateDistance } from '../utils/geofence.js';

/**
 * Get WFA recommendations based on user location
 * Uses Geoapify API to find nearby places and applies Unified Fuzzy AHP scoring
 */
export const getWfaRecommendations = async (req, res, next) => {
  try {
    // Langkah A: Dapatkan Input & Konfigurasi
    const { lat, lng } = req.query;

    // Validasi input
    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        code: 'E_VALIDATION',
        message: 'Parameter lat dan lng wajib diisi'
      });
    }

    // Validasi format koordinat
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        success: false,
        code: 'E_VALIDATION',
        message: 'Format koordinat tidak valid'
      });
    }

    if (latitude < -90 || latitude > 90) {
      return res.status(400).json({
        success: false,
        code: 'E_VALIDATION',
        message: 'Latitude harus antara -90 dan 90'
      });
    }

    if (longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        code: 'E_VALIDATION',
        message: 'Longitude harus antara -180 dan 180'
      });
    }

    // Ambil search radius dari settings
    let searchRadius = 5000; // default 5km
    try {
      const radiusSetting = await Settings.findOne({
        where: { setting_key: 'wfa.recommendation.search_radius' }
      });
      if (radiusSetting) {
        searchRadius = parseInt(radiusSetting.setting_value) || 5000;
      }
    } catch (settingError) {
      logger.warn(`Failed to fetch search radius setting: ${settingError.message}`);
    }

    // Langkah B: Panggil API Geoapify
    const geoapifyApiKey = process.env.GEOAPIFY_API_KEY;
    if (!geoapifyApiKey) {
      logger.error('GEOAPIFY_API_KEY not found in environment variables');
      return res.status(500).json({
        success: false,
        code: 'E_CONFIG',
        message: 'API key Geoapify tidak ditemukan'
      });
    } // Definisikan kategori yang dicari - menggunakan kategori yang terbukti berhasil di Indonesia
    const categories = 'catering,accommodation,office,education';

    // Parameter untuk API Geoapify - simplified untuk Indonesia
    const geoapifyParams = {
      categories,
      filter: `circle:${longitude},${latitude},${searchRadius}`,
      limit: 50,
      apiKey: geoapifyApiKey,
      lang: 'en'
    };
    logger.info(`Calling Geoapify API with params: ${JSON.stringify(geoapifyParams)}`);

    // Retry function for API calls
    const makeGeoapifyRequest = async (retryCount = 0) => {
      try {
        const response = await axios.get('https://api.geoapify.com/v2/places', {
          params: geoapifyParams,
          timeout: 30000, // Increase to 30 seconds
          headers: {
            'User-Agent': 'Infinit-Track-WFA/1.0',
            Accept: 'application/json'
          }
        });
        return response;
      } catch (error) {
        if (retryCount < 2 && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) {
          logger.warn(`Geoapify timeout, retrying... (attempt ${retryCount + 1})`);
          await new Promise((resolve) => setTimeout(resolve, 1000 * (retryCount + 1))); // Progressive delay
          return makeGeoapifyRequest(retryCount + 1);
        }
        throw error;
      }
    };
    const geoapifyResponse = await makeGeoapifyRequest();
    const candidates = geoapifyResponse.data.features || [];

    logger.info(`Geoapify returned ${candidates.length} candidates`); // Scoring with FAHP weights (no FIS)
    // Dapatkan bobot AHP untuk kriteria WFA
    const ahpWeights = fuzzyEngine.getWfaAhpWeights();

    logger.info('Using FAHP weights:', ahpWeights); // Score setiap kandidat menggunakan mesin terpusat
    const scoredRecommendations = [];
    const processedPlaces = new Set(); // Track places dengan multiple identifiers
    const duplicateWarnings = new Set(); // Track warning messages untuk mencegah spam

    for (const place of candidates) {
      try {
        // Create robust place identifier using multiple properties
        const placeName = (place.properties?.name || 'unknown').trim();
        const coordinates = place.geometry?.coordinates || [0, 0];

        // Normalize name untuk matching yang lebih baik
        const normalizedName = placeName
          .toLowerCase()
          .replace(/\s+/g, ' ') // Replace multiple spaces with single space
          .replace(/[^\w\s]/g, '') // Remove special characters except spaces
          .trim();

        // Create composite key: normalized_name + rounded_coordinates
        const coordKey = `${Math.round(coordinates[1] * 10000)},${Math.round(coordinates[0] * 10000)}`;
        const placeKey = `${normalizedName}|${coordKey}`;

        // Check for duplicates
        if (processedPlaces.has(placeKey)) {
          // Only warn once per unique place name to avoid spam
          const warningKey = normalizedName;
          if (!duplicateWarnings.has(warningKey)) {
            logger.warn(`Skipping duplicate place: ${placeName}`);
            duplicateWarnings.add(warningKey);
          }
          continue; // Skip duplikasi
        }

        processedPlaces.add(placeKey);
        // Add user location for distance calculation
        place.userLocation = { lat: latitude, lon: longitude };
        const scoreResult = await fuzzyEngine.calculateWfaScore(place, ahpWeights);

        // Add additional metadata for response
        const scoredPlace = {
          ...place,
          scoring_details: {
            final_score: scoreResult.score,
            label: scoreResult.label,
            breakdown: scoreResult.breakdown,
            distance_meters:
              place.properties?.distance ||
              calculateDistance(
                latitude,
                longitude,
                place.geometry.coordinates[1],
                place.geometry.coordinates[0]
              )
          }
        };

        scoredRecommendations.push(scoredPlace);
      } catch (error) {
        logger.warn(`Failed to score place ${place.properties?.name || 'unknown'}:`, error.message);
        // Include place with default score if scoring fails
        scoredRecommendations.push({
          ...place,
          scoring_details: {
            final_score: 50,
            label: 'Cukup Direkomendasikan',
            breakdown: { error: error.message },
            distance_meters: place.properties?.distance || 1000
          }
        });
      }
    }
    logger.info(`Scored ${scoredRecommendations.length} places using FAHP (no FIS)`);

    // Langkah D: Urutkan berdasarkan skor dan Kirim Respons
    const sortedRecommendations = scoredRecommendations
      .sort((a, b) => b.scoring_details.final_score - a.scoring_details.final_score)
      .slice(0, 30); // Ambil 30 teratas (increased from 10)

    logger.info(`Returning ${sortedRecommendations.length} recommendations`);

    res.status(200).json({
      success: true,
      data: {
        recommendations: sortedRecommendations.map((place) => ({
          name: place.properties.name || place.properties.address_line1 || 'Tempat Tidak Diketahui',
          address:
            place.properties.formatted || place.properties.address_line2 || 'Alamat tidak tersedia',
          latitude: place.geometry.coordinates[1],
          longitude: place.geometry.coordinates[0],
          suitability_score: place.scoring_details.final_score,
          suitability_label: place.scoring_details.label,
          category: fuzzyEngine.getCategoryDisplayName(fuzzyEngine.categorizePlace(place)),
          place_type: fuzzyEngine.categorizePlace(place),
          distance_from_center: place.scoring_details.distance_meters,
          // ✅ ENHANCED MISSING DATA HANDLING
          real_data_analysis: {
            // Data quality assessment
            data_reliability:
              place.scoring_details.breakdown.data_quality?.reliability_rating || 'UNKNOWN',
            confidence_score: place.scoring_details.breakdown.data_quality?.confidence_score || 0,
            data_completeness_percentage:
              place.scoring_details.breakdown.data_quality?.data_completeness_percentage || 0,

            // Missing data information
            missing_data: place.scoring_details.breakdown.data_quality?.missing_data || [],
            critical_missing: place.scoring_details.breakdown.data_quality?.critical_missing || [],
            enhancement_suggestions:
              place.scoring_details.breakdown.data_quality?.enhancement_suggestions || [],

            // Workspace suitability
            workspace_score:
              place.scoring_details.breakdown.workspace_analysis?.work_environment_score || 0,
            power_outlets:
              place.scoring_details.breakdown.workspace_analysis?.power_availability || 0,
            seating_quality:
              place.scoring_details.breakdown.workspace_analysis?.seating_quality || 0,
            noise_level:
              place.scoring_details.breakdown.workspace_analysis?.noise_level_estimate || 0,
            workspace_factors:
              place.scoring_details.breakdown.workspace_analysis?.suitability_factors || [],

            // Internet connectivity information with enhanced fallback details
            internet_info: {
              score: place.scoring_details.breakdown.internet_score || 0,
              confidence: place.scoring_details.breakdown.internet_result?.confidence || 0,
              source: place.scoring_details.breakdown.internet_result?.source || 'UNKNOWN',
              reasoning:
                place.scoring_details.breakdown.internet_result?.reasoning ||
                'No information available'
            },

            // Real amenities dari API
            confirmed_amenities: {
              wifi: place.properties?.amenities?.wifi || false,
              internet_access: place.properties?.amenities?.internet_access || null,
              power_outlets: place.properties?.amenities?.power_outlets || false,
              tables: place.properties?.amenities?.tables || false,
              seating: place.properties?.amenities?.seating || false,
              quiet: place.properties?.amenities?.quiet || false,
              air_conditioning: place.properties?.amenities?.air_conditioning || false,
              business_center: place.properties?.amenities?.business_center || false,
              conference_room: place.properties?.amenities?.conference_room || false
            },

            // Contact and verification data
            contact_available: {
              phone: !!place.properties?.contact?.phone,
              website: !!place.properties?.contact?.website,
              email: !!place.properties?.contact?.email
            },

            // Rating dan review data
            rating: place.properties?.rating || 0,
            total_reviews: place.properties?.reviews_count || 0,

            // Data source confidence
            data_sources: place.scoring_details.breakdown.data_quality?.data_sources || []
          },

          // Detail scoring untuk debugging
          score_details: {
            final_score: place.scoring_details.final_score,
            component_scores: place.scoring_details.breakdown,
            weights_used: ahpWeights,
            cr: ahpWeights.consistency_ratio,
            warning: place.scoring_details.warning || null
          }
        })),
        search_criteria: {
          center_latitude: latitude,
          center_longitude: longitude,
          search_radius_meters: searchRadius,
          categories_searched: categories.split(','),
          total_candidates_found: candidates.length,
          recommendations_returned: sortedRecommendations.length
        },
        fahp_methodology: {
          approach: 'Pure FAHP (TFN + Buckley + centroid)',
          criteria_weights: ahpWeights
        }
      },
      message: 'Rekomendasi WFA berhasil diambil menggunakan FAHP (tanpa FIS)'
    });
  } catch (error) {
    logger.error(`WFA recommendations error: ${error.message}`, { stack: error.stack });

    // Handle specific Axios errors
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return res.status(408).json({
        success: false,
        code: 'E_TIMEOUT',
        message:
          'Request timeout - Layanan Geoapify membutuhkan waktu terlalu lama untuk merespons. Silakan coba lagi.'
      });
    }

    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        success: false,
        code: 'E_SERVICE_UNAVAILABLE',
        message: 'Layanan Geoapify sedang tidak tersedia'
      });
    }

    if (error.response?.status === 401 || error.response?.status === 403) {
      return res.status(500).json({
        success: false,
        code: 'E_API_KEY',
        message: 'API key Geoapify tidak valid atau tidak memiliki akses'
      });
    }

    if (error.response?.status === 429) {
      return res.status(429).json({
        success: false,
        code: 'E_RATE_LIMIT',
        message: 'Terlalu banyak permintaan ke API Geoapify, coba lagi dalam beberapa menit'
      });
    }

    if (error.response?.status >= 500) {
      return res.status(503).json({
        success: false,
        code: 'E_EXTERNAL_SERVER',
        message: 'Server Geoapify mengalami masalah internal'
      });
    }

    // Pass to error handler middleware
    next(error);
  }
};

/**
 * Get current Fuzzy AHP configuration for WFA recommendations
 * Returns the current weights and methodology information
 */
export const getWfaAhpConfig = async (req, res, next) => {
  try {
    // Dapatkan konfigurasi AHP dari mesin terpusat
    const ahpWeights = fuzzyEngine.getWfaAhpWeights();
    res.status(200).json({
      success: true,
      data: {
        current_weights: {
          location_type: ahpWeights.location_type,
          amenity_score: ahpWeights.amenity_score,
          distance_factor: ahpWeights.distance_factor
        },
        consistency_ratio: ahpWeights.consistency_ratio,
        is_consistent: ahpWeights.consistency_ratio <= 0.1,
        method: 'FAHP (TFN + Buckley + centroid) - Comprehensive Amenity Assessment',
        criteria_explanation: {
          location_type:
            'Penilaian berdasarkan kategori tempat (cafe, hotel, coworking space, dll)',
          amenity_score:
            'Penilaian komprehensif fasilitas: WiFi, informasi bisnis, brand recognition, payment options, aksesibilitas, dan keragaman kategori',
          distance_factor: 'Penilaian berdasarkan jarak dari pusat pencarian'
        },
        weight_calculation: 'Menggunakan AHP library dengan expert judgment matrix',
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
 * Test Fuzzy AHP with different scenarios
 * Admin endpoint untuk testing dan debugging algoritma
 */
export const testFuzzyAhp = async (req, res, next) => {
  try {
    const { place_data, custom_weights } = req.body;

    // Validasi input
    if (!place_data) {
      return res.status(400).json({
        success: false,
        message: 'Parameter place_data wajib diisi untuk testing'
      });
    } // Gunakan custom weights jika disediakan, atau default weights
    const weights = custom_weights || fuzzyEngine.getWfaAhpWeights();

    // Test scoring dengan data yang disediakan
    const testResult = await fuzzyEngine.calculateWfaScore(place_data, weights);

    res.status(200).json({
      success: true,
      data: {
        test_result: testResult,
        interpretation: {
          score_range: '0-100',
          score_meaning:
            testResult.score >= 70
              ? 'Recommended'
              : testResult.score >= 50
                ? 'Acceptable'
                : 'Not recommended',
          consistency_check: weights.consistency_ratio <= 0.1 ? 'Consistent' : 'Inconsistent'
        }
      },
      message: 'Test Fuzzy AHP berhasil'
    });
  } catch (error) {
    logger.error(`Error testing Fuzzy AHP: ${error.message}`);
    next(error);
  }
};

/**
 * Debug endpoint untuk testing API Geoapify langsung
 * Admin endpoint untuk diagnosa masalah API coverage
 */
export const debugGeoapifyApi = async (req, res, next) => {
  try {
    const { lat, lng, radius = 10000 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: 'Parameter lat dan lng wajib diisi untuk debug'
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const searchRadius = parseInt(radius);

    const geoapifyApiKey = process.env.GEOAPIFY_API_KEY;
    if (!geoapifyApiKey) {
      return res.status(500).json({
        success: false,
        message: 'GEOAPIFY_API_KEY tidak ditemukan'
      });
    }

    // Test dengan berbagai kombinasi parameter
    const testCases = [
      {
        name: 'Test 1: Basic Categories',
        params: {
          categories: 'catering,accommodation,office,education',
          filter: `circle:${longitude},${latitude},${searchRadius}`,
          limit: 50,
          apiKey: geoapifyApiKey
        }
      },
      {
        name: 'Test 2: All Building Types',
        params: {
          categories: 'building',
          filter: `circle:${longitude},${latitude},${searchRadius}`,
          limit: 50,
          apiKey: geoapifyApiKey
        }
      },
      {
        name: 'Test 3: No Category Filter',
        params: {
          filter: `circle:${longitude},${latitude},${searchRadius}`,
          limit: 50,
          apiKey: geoapifyApiKey
        }
      }
    ];

    const results = [];

    for (const testCase of testCases) {
      try {
        logger.info(`Running ${testCase.name} with params:`, testCase.params);

        const response = await axios.get('https://api.geoapify.com/v2/places', {
          params: testCase.params,
          timeout: 30000,
          headers: {
            'User-Agent': 'Infinit-Track-WFA-Debug/1.0',
            Accept: 'application/json'
          }
        });

        const features = response.data.features || [];

        results.push({
          test_name: testCase.name,
          params_used: testCase.params,
          results_count: features.length,
          sample_places: features.slice(0, 3).map((place) => ({
            name: place.properties?.name || 'Unnamed',
            categories: place.properties?.categories || [],
            address: place.properties?.formatted || 'No address',
            distance: calculateDistance(
              latitude,
              longitude,
              place.geometry.coordinates[1],
              place.geometry.coordinates[0]
            )
          })),
          status: 'SUCCESS'
        });
      } catch (error) {
        results.push({
          test_name: testCase.name,
          params_used: testCase.params,
          error: error.message,
          status: 'FAILED',
          response_status: error.response?.status || 'NO_RESPONSE'
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        location_tested: {
          latitude,
          longitude,
          radius: searchRadius
        },
        api_key_status: geoapifyApiKey ? 'AVAILABLE' : 'MISSING',
        test_results: results,
        summary: {
          total_tests: testCases.length,
          successful_tests: results.filter((r) => r.status === 'SUCCESS').length,
          failed_tests: results.filter((r) => r.status === 'FAILED').length,
          total_places_found: results.reduce((sum, r) => sum + (r.results_count || 0), 0)
        },
        recommendations: [
          'Jika semua test gagal, cek API key Geoapify',
          'Jika Test 3 (no category) berhasil, masalah di kategori filter',
          'Jika tidak ada data sama sekali, kemungkinan coverage Geoapify terbatas di area tersebut'
        ]
      },
      message: 'Debug Geoapify API completed'
    });
  } catch (error) {
    logger.error(`Debug Geoapify API error: ${error.message}`);
    next(error);
  }
};
