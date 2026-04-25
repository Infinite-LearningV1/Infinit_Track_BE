/**
 * Discipline Index Controller - Menggunakan FAHP (tanpa FIS)
 * Controller untuk menghitung dan menampilkan indeks kedisiplinan karyawan
 * menggunakan sistem inferensi fuzzy yang terintegrasi dengan AHP
 */

import { Op } from 'sequelize';

import { Attendance, User, Role } from '../models/index.js';
import fuzzyEngine from '../utils/fuzzyAhpEngine.js';
import logger from '../utils/logger.js';

/**
 * Calculate discipline index for a specific user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export const getUserDisciplineIndex = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { months = 1 } = req.query; // Default 1 bulan terakhir

    // Validasi akses - hanya admin/management atau user sendiri yang bisa akses
    if (
      req.user.role_name !== 'Admin' &&
      req.user.role_name !== 'Management' &&
      req.user.id !== parseInt(userId)
    ) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Anda hanya dapat melihat indeks kedisiplinan Anda sendiri.'
      });
    }

    // Validasi user exists
    const user = await User.findByPk(userId, {
      include: [
        {
          model: Role,
          as: 'role',
          attributes: ['role_name']
        }
      ]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan.'
      });
    }

    // Hitung periode analisis
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));

    // Aggregate data absensi untuk periode tersebut
    const userMetrics = await aggregateUserMetrics(userId, startDate, endDate); // Dapatkan bobot AHP untuk kriteria disiplin
    const ahpWeights = fuzzyEngine.getDisciplineAhpWeights();

    // Hitung indeks kedisiplinan menggunakan Fuzzy AHP Engine
    const disciplineResult = await fuzzyEngine.calculateDisciplineIndex(userMetrics, ahpWeights);

    logger.info(
      `Discipline index calculated for user ${userId}: ${disciplineResult.score} (${disciplineResult.label})`
    );

    res.status(200).json({
      success: true,
      data: {
        user_info: {
          user_id: user.id_users,
          full_name: user.full_name,
          nip_nim: user.nip_nim,
          role: user.role?.role_name
        },
        analysis_period: {
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
          months_analyzed: parseInt(months)
        },
        discipline_index: {
          score: disciplineResult.score,
          label: disciplineResult.label,
          category: getDisciplineCategory(disciplineResult.score)
        },
        raw_metrics: userMetrics,
        fuzzy_breakdown: disciplineResult.breakdown,
        methodology: {
          engine: 'FAHP',
          criteria_weights: ahpWeights,
          approach: 'TFN pairwise + Buckley + centroid; weighted normalization'
        }
      },
      message: 'Indeks kedisiplinan berhasil dihitung menggunakan FAHP (tanpa FIS)'
    });
  } catch (error) {
    logger.error('Error calculating user discipline index:', error);
    next(error);
  }
};

/**
 * Test endpoint: Calculate Discipline Index from manual metrics (no DB)
 * POST /api/discipline/test-ahp
 * Body example:
 * {
 *   "metrics": {
 *     "alpha_rate": 12,
 *     "avg_lateness_minutes": 8,
 *     "lateness_frequency": 15,
 *     "work_hour_consistency": 82
 *   }
 * }
 */
export const testDisciplineAhp = async (req, res, next) => {
  try {
    const { metrics } = req.body || {};
    if (!metrics) {
      return res.status(400).json({ success: false, message: 'Parameter metrics wajib diisi' });
    }

    const ahpWeights = fuzzyEngine.getDisciplineAhpWeights();
    const result = await fuzzyEngine.calculateDisciplineIndex(metrics, ahpWeights);

    return res.status(200).json({
      success: true,
      data: {
        discipline_result: result,
        methodology: {
          engine: 'FAHP',
          criteria_weights: ahpWeights,
          scoring_ranges: {
            'Sangat Tinggi': '>=80',
            Tinggi: '60-79.9',
            Sedang: '40-59.9',
            Rendah: '20-39.9',
            'Sangat Rendah': '<20'
          }
        }
      },
      message: 'Discipline Index computed from manual metrics'
    });
  } catch (error) {
    logger.error('Error in testDisciplineAhp:', error);
    next(error);
  }
};

/**
 * Calculate discipline index for all users (Admin/Management only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export const getAllDisciplineIndices = async (req, res, next) => {
  try {
    // Only allow admins and management
    if (req.user.role_name !== 'Admin' && req.user.role_name !== 'Management') {
      return res.status(403).json({
        success: false,
        message:
          'Akses ditolak. Hanya admin dan manajemen yang dapat melihat indeks kedisiplinan semua karyawan.'
      });
    }

    const { months = 1, page = 1, limit = 20, sort = 'score_desc' } = req.query;

    // Get all active users (exclude admins from analysis)
    const users = await User.findAll({
      include: [
        {
          model: Role,
          as: 'role',
          attributes: ['role_name'],
          where: {
            role_name: { [Op.notIn]: ['Admin'] } // Exclude admins from discipline analysis
          }
        }
      ],
      attributes: ['id_users', 'full_name', 'nip_nim', 'email']
    });

    logger.info(`Calculating discipline indices for ${users.length} users`); // Calculate discipline index for each user
    const disciplineResults = [];
    const ahpWeights = fuzzyEngine.getDisciplineAhpWeights();

    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));

    const userIds = users.map((user) => user.id_users);

    const attendances = userIds.length
      ? await Attendance.findAll({
          where: {
            user_id: { [Op.in]: userIds },
            attendance_date: {
              [Op.between]: [
                startDate.toISOString().split('T')[0],
                endDate.toISOString().split('T')[0]
              ]
            }
          }
        })
      : [];

    const attendancesByUser = groupAttendancesByUser(attendances);

    for (const user of users) {
      try {
        const userMetrics = aggregateMetricsFromAttendances(
          attendancesByUser[user.id_users] || [],
          startDate,
          endDate
        );
        const disciplineResult = await fuzzyEngine.calculateDisciplineIndex(
          userMetrics,
          ahpWeights
        );

        disciplineResults.push({
          user_id: user.id_users,
          full_name: user.full_name,
          nip_nim: user.nip_nim,
          role_name: user.role?.role_name,
          discipline_score: disciplineResult.score,
          discipline_label: disciplineResult.label,
          discipline_category: getDisciplineCategory(disciplineResult.score),
          raw_metrics: userMetrics
        });
      } catch (error) {
        logger.error(`Error calculating discipline for user ${user.id_users}:`, error);

        // Add user with error indicator
        disciplineResults.push({
          user_id: user.id_users,
          full_name: user.full_name,
          nip_nim: user.nip_nim,
          role_name: user.role?.role_name,
          discipline_score: null,
          discipline_label: 'Error',
          discipline_category: 'Error',
          error: error.message
        });
      }
    }

    // Sort results
    const sortedResults = sortDisciplineResults(disciplineResults, sort);

    // Apply pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    const paginatedResults = sortedResults.slice(offset, offset + limitNum);

    // Calculate summary statistics
    const validResults = disciplineResults.filter((r) => r.discipline_score !== null);
    const summary = calculateDisciplineSummary(validResults);

    res.status(200).json({
      success: true,
      data: {
        discipline_indices: paginatedResults,
        summary_statistics: summary,
        analysis_period: {
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
          months_analyzed: parseInt(months)
        },
        pagination: {
          current_page: pageNum,
          total_pages: Math.ceil(disciplineResults.length / limitNum),
          total_records: disciplineResults.length,
          records_per_page: limitNum
        },
        methodology: {
          engine: 'FAHP',
          criteria_weights: ahpWeights,
          approach: 'TFN pairwise + Buckley + centroid; weighted normalization'
        }
      },
      message: `Indeks kedisiplinan ${validResults.length} karyawan berhasil dihitung`
    });
  } catch (error) {
    logger.error('Error calculating all discipline indices:', error);
    next(error);
  }
};

/**
 * Get discipline index configuration and weights
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export const getDisciplineConfig = async (req, res, next) => {
  try {
    // Only allow admins and management to view configuration
    if (req.user.role_name !== 'Admin' && req.user.role_name !== 'Management') {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Hanya admin dan manajemen yang dapat melihat konfigurasi.'
      });
    }

    const ahpWeights = fuzzyEngine.getDisciplineAhpWeights();

    res.status(200).json({
      success: true,
      data: {
        criteria_weights: ahpWeights,
        criteria_definitions: {
          lateness: 'Tingkat keterlambatan (persentase hari terlambat)',
          absenteeism: 'Tingkat ketidakhadiran (persentase hari tidak hadir)',
          overtime: 'Frekuensi lembur (persentase hari lembur)',
          consistency: 'Konsistensi kehadiran (skor konsistensi 0-100)'
        },
        scoring_ranges: {
          'Sangat Disiplin': '85-100',
          Disiplin: '70-84',
          'Cukup Disiplin': '55-69',
          'Kurang Disiplin': '40-54',
          'Tidak Disiplin': '0-39'
        },
        fuzzy_logic_approach: 'Triangular membership functions with IF-THEN rules',
        consistency_ratio: ahpWeights.consistency_ratio,
        is_consistent: ahpWeights.consistency_ratio <= 0.1
      },
      message: 'Konfigurasi Fuzzy AHP untuk indeks kedisiplinan'
    });
  } catch (error) {
    logger.error('Error getting discipline configuration:', error);
    next(error);
  }
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Group attendances by user id
 * @param {Array} attendances - Attendance records
 * @returns {Object} Attendances grouped by user id
 */
function groupAttendancesByUser(attendances) {
  return attendances.reduce((grouped, attendance) => {
    const key = attendance.user_id;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(attendance);
    return grouped;
  }, {});
}

/**
 * Aggregate metrics from attendance records for discipline calculation
 * @param {Array} attendances - Attendance records
 * @param {Date} startDate - Start date for analysis
 * @param {Date} endDate - End date for analysis
 * @returns {Object} Aggregated metrics
 */
function aggregateMetricsFromAttendances(attendances, startDate, endDate) {
  // Calculate total working days in period (excluding weekends)
  const totalWorkingDays = calculateWorkingDays(startDate, endDate);

  // Calculate metrics
  const totalAttendances = attendances.length;
  const lateAttendances = attendances.filter((att) => {
    if (!att.time_in) return false;
    const timeIn = new Date(att.time_in);
    const hour = timeIn.getHours();
    const minute = timeIn.getMinutes();
    return hour > 9 || (hour === 9 && minute > 0); // After 09:00 considered late
  }).length;

  const overtimeAttendances = attendances.filter((att) => {
    return att.work_hour && parseFloat(att.work_hour) > 8.0;
  }).length;

  const alphaAttendances = attendances.filter((att) => {
    return att.status_id === 3; // Alpha status
  }).length;

  // Calculate rates (as percentages)
  const lateness_rate = totalWorkingDays > 0 ? (lateAttendances / totalWorkingDays) * 100 : 0;
  const absenteeism_rate = totalWorkingDays > 0 ? (alphaAttendances / totalWorkingDays) * 100 : 0;
  const overtime_frequency =
    totalAttendances > 0 ? (overtimeAttendances / totalAttendances) * 100 : 0;

  // Calculate consistency (attendance rate)
  const attendance_consistency =
    totalWorkingDays > 0 ? (totalAttendances / totalWorkingDays) * 100 : 0;

  // Lateness frequency over the last 1 month window (relative to endDate)
  const lfStartDate = new Date(endDate);
  lfStartDate.setMonth(lfStartDate.getMonth() - 1);

  const workingDaysLastMonth = calculateWorkingDays(lfStartDate, endDate);

  const lateAttendancesLastMonth = attendances.filter((att) => {
    // Ensure attendance falls within the last 1 month window
    const attDate = att.attendance_date ? new Date(att.attendance_date) : null;
    if (!attDate || attDate < lfStartDate || attDate > endDate) return false;
    if (!att.time_in) return false;
    const timeIn = new Date(att.time_in);
    const hour = timeIn.getHours();
    const minute = timeIn.getMinutes();
    return hour > 9 || (hour === 9 && minute > 0);
  }).length;

  const lateness_frequency =
    workingDaysLastMonth > 0 ? (lateAttendancesLastMonth / workingDaysLastMonth) * 100 : 0;

  return {
    lateness_rate: Math.round(lateness_rate * 100) / 100,
    absenteeism_rate: Math.round(absenteeism_rate * 100) / 100,
    overtime_frequency: Math.round(overtime_frequency * 100) / 100,
    attendance_consistency: Math.min(100, Math.round(attendance_consistency * 100) / 100),
    // Added for FAHP engine compatibility (1-month period)
    lateness_frequency: Math.round(lateness_frequency * 100) / 100,

    // Additional details
    total_working_days: totalWorkingDays,
    total_attendances: totalAttendances,
    late_days: lateAttendances,
    overtime_days: overtimeAttendances,
    alpha_days: alphaAttendances
  };
}

/**
 * Aggregate user metrics for discipline calculation
 * @param {number} userId - User ID
 * @param {Date} startDate - Start date for analysis
 * @param {Date} endDate - End date for analysis
 * @returns {Object} Aggregated metrics
 */
async function aggregateUserMetrics(userId, startDate, endDate) {
  try {
    // Get all attendance records for the period
    const attendances = await Attendance.findAll({
      where: {
        user_id: userId,
        attendance_date: {
          [Op.between]: [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
        }
      }
    });

    return aggregateMetricsFromAttendances(attendances, startDate, endDate);
  } catch (error) {
    logger.error(`Error aggregating metrics for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Calculate working days between two dates (excluding weekends)
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {number} Number of working days
 */
function calculateWorkingDays(startDate, endDate) {
  let workingDays = 0;
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      // Not Sunday (0) or Saturday (6)
      workingDays++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return workingDays;
}

/**
 * Get discipline category based on score
 * @param {number} score - Discipline score
 * @returns {string} Category
 */
function getDisciplineCategory(score) {
  if (score >= 85) return 'Excellent';
  if (score >= 70) return 'Good';
  if (score >= 55) return 'Average';
  if (score >= 40) return 'Below Average';
  return 'Poor';
}

/**
 * Sort discipline results based on criteria
 * @param {Array} results - Array of discipline results
 * @param {string} sortCriteria - Sort criteria
 * @returns {Array} Sorted results
 */
function sortDisciplineResults(results, sortCriteria) {
  switch (sortCriteria) {
    case 'score_desc':
      return results.sort((a, b) => (b.discipline_score || 0) - (a.discipline_score || 0));
    case 'score_asc':
      return results.sort((a, b) => (a.discipline_score || 0) - (b.discipline_score || 0));
    case 'name_asc':
      return results.sort((a, b) => a.full_name.localeCompare(b.full_name));
    case 'name_desc':
      return results.sort((a, b) => b.full_name.localeCompare(a.full_name));
    default:
      return results;
  }
}

/**
 * Calculate summary statistics for discipline indices
 * @param {Array} results - Array of valid discipline results
 * @returns {Object} Summary statistics
 */
function calculateDisciplineSummary(results) {
  if (results.length === 0) {
    return {
      total_users: 0,
      average_score: 0,
      highest_score: 0,
      lowest_score: 0,
      distribution: {}
    };
  }

  const scores = results.map((r) => r.discipline_score);
  const total = scores.reduce((sum, score) => sum + score, 0);
  const average = total / scores.length;

  // Calculate distribution
  const distribution = {
    'Sangat Disiplin': results.filter((r) => r.discipline_score >= 85).length,
    Disiplin: results.filter((r) => r.discipline_score >= 70 && r.discipline_score < 85).length,
    'Cukup Disiplin': results.filter((r) => r.discipline_score >= 55 && r.discipline_score < 70)
      .length,
    'Kurang Disiplin': results.filter((r) => r.discipline_score >= 40 && r.discipline_score < 55)
      .length,
    'Tidak Disiplin': results.filter((r) => r.discipline_score < 40).length
  };

  return {
    total_users: results.length,
    average_score: Math.round(average * 100) / 100,
    highest_score: Math.max(...scores),
    lowest_score: Math.min(...scores),
    distribution
  };
}
