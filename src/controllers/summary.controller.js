import { Op } from 'sequelize';

import sequelize from '../config/database.js';
import {
  Attendance,
  User,
  Role,
  Location,
  AttendanceCategory,
  AttendanceStatus,
  Settings
} from '../models/index.js';
import logger from '../utils/logger.js';
import { formatWorkHour, formatTimeOnly, calculateWorkHour } from '../utils/workHourFormatter.js';
import fuzzyAhpEngine from '../utils/fuzzyAhpEngine.js';
import { buildDashboardAnalytics } from '../utils/dashboardAnalytics.js';

/**
 * Calculate user metrics for discipline index calculation
 * @param {number} userId - User ID
 * @param {Date} startDate - Start date for calculation
 * @param {Date} endDate - End date for calculation
 * @returns {Object} User metrics object
 */
const calculateUserMetrics = async (userId, startDate, endDate, settingsMap = null) => {
  try {
    const effectiveSettingsMap = settingsMap || {};
    const checkinStartTime = effectiveSettingsMap['checkin.start_time'] || '08:00:00';

    const startParts = checkinStartTime.split(':').map((v) => parseInt(v, 10) || 0);
    const startMinutes = (startParts[0] || 0) * 60 + (startParts[1] || 0);

    const whereClause = {
      user_id: userId
    };

    // Add date filter if provided
    if (startDate && endDate) {
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      whereClause.attendance_date = {
        [Op.between]: [startDateStr, endDateStr]
      };
    }

    // Get all attendance records for the user in the period
    const attendanceRecords = await Attendance.findAll({
      where: whereClause,
      include: [
        {
          model: AttendanceStatus,
          as: 'status',
          attributes: ['attendance_status_name']
        }
      ]
    });

    if (attendanceRecords.length === 0) {
      return {
        alpha_rate: 0, // percent 0..100
        avg_lateness_minutes: 0, // minutes 0..60
        lateness_frequency: 0, // percent 0..100
        work_hour_consistency: 0 // percent 0..100
      };
    }

    // Calculate metrics according to FAHP discipline indicators (attendance-only)
    const totalDays = attendanceRecords.length; // observation days within selected period

    // Separate present vs alpha
    let alphaDays = 0;
    const presentRecords = [];
    for (const record of attendanceRecords) {
      const statusName = (record.status?.attendance_status_name || '').toLowerCase();
      if (statusName === 'alpa' || statusName === 'alpha') {
        alphaDays++;
      } else {
        presentRecords.push(record);
      }
    }

    const presentDays = presentRecords.length;

    // Lateness calculations across present days
    let lateDays = 0;
    let totalLatenessMinutes = 0;
    let consistencyDays = 0; // days with work_hour >= 8.0

    for (const record of presentRecords) {
      const statusName = (record.status?.attendance_status_name || '').toLowerCase();
      if (statusName === 'terlambat' || statusName === 'late') lateDays++;

      // time_in-based lateness vs checkin.start_time (minutes)
      if (record.time_in) {
        const hhmm = formatTimeOnly(record.time_in); // 'HH:MM' in WIB
        const parts = hhmm.split(':').map((v) => parseInt(v, 10) || 0);
        const timeInMinutes = (parts[0] || 0) * 60 + (parts[1] || 0);
        const lateness = Math.max(0, timeInMinutes - startMinutes);
        totalLatenessMinutes += lateness;
      }

      // work hour consistency >= 8.0 hours
      const wh = parseFloat(record.work_hour);
      if (!Number.isNaN(wh) && wh >= 8.0) consistencyDays++;
    }

    // Metrics in required units
    const alphaRateRatio = totalDays > 0 ? alphaDays / totalDays : 0; // 0..1
    const latenessFrequencyRatio = presentDays > 0 ? lateDays / presentDays : 0; // 0..1
    const avgLatenessMinutes = presentDays > 0 ? totalLatenessMinutes / presentDays : 0; // minutes
    const workHourConsistencyRatio = presentDays > 0 ? consistencyDays / presentDays : 0; // 0..1

    // Clamp to specified ranges and convert to engine units (percent for ratios)
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const clampMin = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    const alpha_rate = Math.round(clamp01(alphaRateRatio) * 10000) / 100; // %
    const lateness_frequency = Math.round(clamp01(latenessFrequencyRatio) * 10000) / 100; // %
    const work_hour_consistency = Math.round(clamp01(workHourConsistencyRatio) * 10000) / 100; // %
    const avg_lateness_minutes = Math.round(clampMin(avgLatenessMinutes, 0, 60) * 100) / 100; // minutes 0..60

    return {
      alpha_rate,
      avg_lateness_minutes,
      lateness_frequency,
      work_hour_consistency,
      total_days: totalDays,
      alpha_days: alphaDays,
      late_days: lateDays
    };
  } catch (error) {
    logger.error('Error calculating user metrics:', error);
    return {
      alpha_rate: 0,
      avg_lateness_minutes: 0,
      lateness_frequency: 0,
      work_hour_consistency: 0
    };
  }
};
/**
 * Get summary report for admin and management with Discipline Index integration
 * Provides aggregated summary data (counts by status & category)
 * AND detailed attendance report with time filters, pagination, and discipline scoring
 * @route GET /api/summary
 * @access Admin, Management
 */
export const getSummaryReport = async (req, res, next) => {
  try {
    const { period = 'daily', page = 1, limit = 10 } = req.query;

    // Validasi parameter period
    const validPeriods = ['daily', 'weekly', 'monthly', 'all'];
    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        code: 'E_VALIDATION',
        message: 'Parameter period harus berupa: daily, weekly, monthly, atau all'
      });
    }

    // Hitung rentang tanggal berdasarkan period dengan timezone Asia/Jakarta
    const today = new Date();
    const jakartaOffset = 7 * 60; // UTC+7 dalam menit
    const localTime = new Date(today.getTime() + jakartaOffset * 60000);

    let startDate, endDate;

    switch (period) {
      case 'daily':
        // Hari ini saja
        startDate = new Date(localTime);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(localTime);
        endDate.setUTCHours(23, 59, 59, 999);
        break;
      case 'weekly': {
        // Minggu ini (Senin - Minggu)
        const dayOfWeek = localTime.getUTCDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Sunday = 0, Monday = 1

        startDate = new Date(localTime);
        startDate.setUTCDate(localTime.getUTCDate() - daysToMonday);
        startDate.setUTCHours(0, 0, 0, 0);

        endDate = new Date(startDate);
        endDate.setUTCDate(startDate.getUTCDate() + 6);
        endDate.setUTCHours(23, 59, 59, 999);
        break;
      }
      case 'monthly':
        // Bulan ini
        startDate = new Date(localTime.getUTCFullYear(), localTime.getUTCMonth(), 1);
        endDate = new Date(localTime.getUTCFullYear(), localTime.getUTCMonth() + 1, 0);
        endDate.setUTCHours(23, 59, 59, 999);
        break;
      case 'all':
        // Semua data - tidak ada filter tanggal
        startDate = null;
        endDate = null;
        break;
      default:
        startDate = new Date(localTime);
        startDate.setUTCHours(0, 0, 0, 0);
        endDate = new Date(localTime);
        endDate.setUTCHours(23, 59, 59, 999);
    }

    // Format tanggal untuk query database (YYYY-MM-DD)
    const startDateStr = startDate ? startDate.toISOString().split('T')[0] : null;
    const endDateStr = endDate ? endDate.toISOString().split('T')[0] : null;

    logger.info(
      `Generating summary report with discipline analysis - Period: ${period}, Range: ${startDateStr || 'unlimited'} to ${endDateStr || 'unlimited'}`
    );

    // Buat where condition berdasarkan period
    const whereClause = {};
    if (period !== 'all' && startDateStr && endDateStr) {
      whereClause.attendance_date = {
        [Op.between]: [startDateStr, endDateStr]
      };
    }

    // ==== QUERY UNTUK DATA SUMMARY (AGREGAT) ====

    // Query untuk summary berdasarkan status
    const statusCounts = await Attendance.findAll({
      where: whereClause,
      group: ['status_id'],
      attributes: ['status_id', [sequelize.fn('COUNT', sequelize.col('status_id')), 'total']],
      include: [
        {
          model: AttendanceStatus,
          as: 'status',
          attributes: ['attendance_status_name']
        }
      ],
      raw: false
    });

    // Query untuk summary berdasarkan kategori
    const categoryCounts = await Attendance.findAll({
      where: whereClause,
      group: ['category_id'],
      attributes: ['category_id', [sequelize.fn('COUNT', sequelize.col('category_id')), 'total']],
      include: [
        {
          model: AttendanceCategory,
          as: 'attendance_category',
          attributes: ['category_name']
        }
      ],
      raw: false
    });

    // Proses hasil query menjadi objek summary dengan format yang lebih baik
    const summary = {
      total_ontime: 0,
      total_late: 0,
      total_early: 0,
      total_alpha: 0,
      total_wfo: 0,
      total_wfh: 0,
      total_wfa: 0
    };

    // Proses status counts - hitung berdasarkan nama status
    statusCounts.forEach((item) => {
      const statusName = item.status?.attendance_status_name || 'unknown';
      const total = parseInt(item.dataValues.total);

      // Mapping status ke field summary dengan dukungan dynamic status logic
      switch (statusName.toLowerCase()) {
        case 'tepat waktu':
        case 'ontime':
          summary.total_ontime = total;
          break;
        case 'terlambat':
        case 'late':
          summary.total_late = total;
          break;
        case 'early':
        case 'lebih awal':
          summary.total_early = total;
          break;
        case 'alpa':
        case 'alpha':
          summary.total_alpha = total;
          break;
        default:
          // Log status yang tidak dikenali untuk debugging
          logger.warn(`Unknown status found: ${statusName}`);
          break;
      }
    });

    // Proses category counts - hitung berdasarkan nama kategori
    categoryCounts.forEach((item) => {
      const categoryName = item.attendance_category?.category_name || 'unknown';
      const total = parseInt(item.dataValues.total);

      // Mapping kategori ke field summary
      switch (categoryName.toLowerCase()) {
        case 'wfo':
        case 'work from office':
          summary.total_wfo = total;
          break;
        case 'wfh':
        case 'work from home':
          summary.total_wfh = total;
          break;
        case 'wfa':
        case 'work from anywhere':
          summary.total_wfa = total;
          break;
        default:
          // Log kategori yang tidak dikenali untuk debugging
          logger.warn(`Unknown category found: ${categoryName}`);
          break;
      }
    });

    // ==== QUERY UNTUK LAPORAN DETAIL (DENGAN PAGINASI) ====

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const attendanceData = await Attendance.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id_users', 'full_name', 'email', 'nip_nim'],
          include: [
            {
              model: Role,
              as: 'role',
              attributes: ['role_name']
            }
          ]
        },
        {
          model: Location,
          as: 'location',
          attributes: ['location_id', 'description', 'latitude', 'longitude'],
          required: false,
          include: [
            {
              model: AttendanceCategory,
              as: 'attendance_category',
              attributes: ['category_name']
            }
          ]
        },
        {
          model: AttendanceCategory,
          as: 'attendance_category',
          attributes: ['category_name']
        },
        {
          model: AttendanceStatus,
          as: 'status',
          attributes: ['attendance_status_name']
        }
      ],
      order: [
        ['attendance_date', 'DESC'],
        ['time_in', 'DESC']
      ],
      limit: parseInt(limit),
      offset: offset
    });

    // ==== SMART ANALYTICS: CALCULATE DISCIPLINE INDEX ====

    // Get unique users from the attendance data
    const uniqueUsers = {};
    attendanceData.rows.forEach((attendance) => {
      const userId = attendance.user?.id_users;
      if (userId && !uniqueUsers[userId]) {
        uniqueUsers[userId] = attendance.user;
      }
    });

    const settingsMap = {};
    try {
      const settings = await Settings.findAll({
        where: {
          setting_key: {
            [Op.in]: ['checkin.start_time']
          }
        }
      });

      settings.forEach((setting) => {
        settingsMap[setting.setting_key] = setting.setting_value;
      });
    } catch (error) {
      logger.error('Error preloading summary settings:', error);
    }

    // Calculate discipline index for each user
    const userDisciplineMap = {};
    const disciplineCalculationPromises = Object.keys(uniqueUsers).map(async (userId) => {
      try {
        const userMetrics = await calculateUserMetrics(parseInt(userId, 10), startDate, endDate, settingsMap);
        const disciplineResult = await fuzzyAhpEngine.calculateDisciplineIndex(userMetrics);

        userDisciplineMap[userId] = {
          discipline_score: disciplineResult.score,
          discipline_label: disciplineResult.label,
          discipline_breakdown: disciplineResult.breakdown
        };

        logger.info(
          `Discipline calculated for user ${userId}: ${disciplineResult.score} (${disciplineResult.label})`
        );
      } catch (error) {
        logger.error(`Error calculating discipline for user ${userId}:`, error);
        userDisciplineMap[userId] = {
          discipline_score: 50,
          discipline_label: fuzzyAhpEngine.getDisciplineLabel(50),
          discipline_breakdown: { error: 'Calculation failed' }
        };
      }
    });

    // Wait for all discipline calculations to complete
    await Promise.all(disciplineCalculationPromises);

    logger.info(`Discipline analysis completed for ${Object.keys(userDisciplineMap).length} users`);

    // ==== TRANSFORMASI DATA LAPORAN DETAIL DENGAN DISIPLIN INDEX ====

    const transformedData = attendanceData.rows.map((attendance) => {
      const user = attendance.user;
      const location = attendance.location;
      const category = attendance.attendance_category;
      const status = attendance.status;

      // Pisahkan full_name dan role
      const fullName = user?.full_name || 'Unknown User';
      const roleName = user?.role?.role_name || null;
      const userId = user?.id_users;

      // Get discipline data for this user
      const disciplineData = userId ? userDisciplineMap[userId] : null;

      // Kondisi khusus untuk "alpha"
      let timeIn = attendance.time_in;
      let timeOut = attendance.time_out;
      let workHour = attendance.work_hour;
      let locationDetails = null;

      if (status?.attendance_status_name === 'alpa') {
        // Set data khusus untuk alpha
        timeIn = '00:00:00';
        timeOut = '00:00:00';
        workHour = 0;
        locationDetails = null;
      } else {
        // Format data normal untuk status lain
        locationDetails = location
          ? {
              location_id: location.location_id,
              description: location.description,
              category:
                location.attendance_category?.category_name || category?.category_name || 'Unknown',
              coordinates: {
                latitude: parseFloat(location.latitude),
                longitude: parseFloat(location.longitude)
              }
            }
          : {
              location_id: null,
              description: 'Location not specified',
              category: category?.category_name || 'Unknown',
              coordinates: null
            };
      }

      // Status informasi
      // Enrich information string with predicted checkout and duration if available in notes
      let information =
        timeOut && timeOut !== '00:00:00'
          ? `Work Duration: ${formatWorkHour(workHour)}`
          : 'Currently checked in';

      const notesStr = attendance.notes || '';
      const smartMatch = notesStr.match(/\[Smart AC\]\s*pred=([^,]+),\s*used=([^,]+),/);
      const fallbackMatch = notesStr.match(/\[Fallback AC\]\s*used=([^,]+),/);
      let predOutStr = null;
      let modeLabel = null;
      if (smartMatch) {
        predOutStr = smartMatch[1];
        modeLabel = 'smart';
      } else if (fallbackMatch) {
        predOutStr = fallbackMatch[1];
        modeLabel = 'fallback';
      }

      if (predOutStr) {
        // Append PredOut
        information = `${information} | PredOut: ${predOutStr} (${modeLabel})`;
        // Compute PredDur from time_in to PredOut (clamped at 0 if negative)
        try {
          const usedDate = new Date(`${attendance.attendance_date}T${predOutStr}:00+07:00`);
          const inDate = new Date(attendance.time_in);
          const diffMs = Math.max(0, usedDate.getTime() - inDate.getTime());
          const diffHours = diffMs / (1000 * 60 * 60);
          information = `${information} | PredDur: ${formatWorkHour(diffHours)}`;
        } catch (_e) {
          // ignore
        }
      }

      // Derive displayed work_hour if DB value is zero or inconsistent (time_out < time_in)
      let workHourDisplay = workHour;
      try {
        const rawIn = attendance.time_in ? new Date(attendance.time_in) : null;
        const rawOut = attendance.time_out ? new Date(attendance.time_out) : null;
        const outBeforeIn = rawIn && rawOut ? rawOut.getTime() < rawIn.getTime() : false;

        if (workHourDisplay == null || workHourDisplay <= 0 || outBeforeIn) {
          if (predOutStr && rawIn) {
            const usedDate = new Date(`${attendance.attendance_date}T${predOutStr}:00+07:00`);
            workHourDisplay = calculateWorkHour(rawIn, usedDate);
          } else if (rawIn && rawOut) {
            workHourDisplay = calculateWorkHour(rawIn, rawOut);
          }
        }
      } catch (_e) {
        // keep original workHour
      }

      return {
        attendance_id: attendance.id_attendance,
        user_id: userId || null,
        full_name: fullName,
        role: roleName,
        nip_nim: user?.nip_nim || null,
        email: user?.email || null,
        time_in: formatTimeOnly(timeIn),
        time_out: timeOut ? formatTimeOnly(timeOut) : null,
        work_hour: formatWorkHour(workHourDisplay),
        attendance_date: attendance.attendance_date,
        location_details: locationDetails,
        status: status?.attendance_status_name || 'unknown',
        information: information,
        notes: attendance.notes || '',

        // ==== NEW: DISCIPLINE INDEX INTEGRATION ====
        discipline_score: disciplineData?.discipline_score || null,
        discipline_label: disciplineData?.discipline_label || null,
        discipline_breakdown: disciplineData?.discipline_breakdown || null
      };
    });

    // ==== PAGINATION INFO ====

    const pagination = {
      current_page: parseInt(page),
      total_pages: Math.ceil(attendanceData.count / parseInt(limit)),
      total_items: attendanceData.count,
      items_per_page: parseInt(limit),
      has_next_page: parseInt(page) < Math.ceil(attendanceData.count / parseInt(limit)),
      has_prev_page: parseInt(page) > 1
    };

    // ==== ANALYTICS SUMMARY ====
    const analyticsUsersCount = Object.keys(userDisciplineMap).length;
    const avgDisciplineScore =
      analyticsUsersCount > 0
        ? Object.values(userDisciplineMap).reduce((sum, d) => sum + d.discipline_score, 0) /
          analyticsUsersCount
        : 0;

    logger.info(
      `Summary report with discipline analysis generated successfully - ${attendanceData.count} detail records, ${analyticsUsersCount} users analyzed, avg discipline: ${avgDisciplineScore.toFixed(1)}`
    );

    // ==== BENTUK DAN KIRIM RESPONS AKHIR (HTTP 200 OK) ====

    res.status(200).json({
      success: true,
      summary: summary,
      report: {
        data: transformedData,
        pagination: pagination
      },
      analytics: {
        discipline_analysis: {
          users_analyzed: analyticsUsersCount,
          average_discipline_score: Math.round(avgDisciplineScore * 100) / 100,
          methodology: 'Fuzzy AHP Engine',
          criteria: ['Alpha Rate', 'Lateness Severity', 'Lateness Frequency', 'Work Focus']
        }
      },
      period: period,
      date_range:
        period === 'all'
          ? {
              start_date: 'unlimited',
              end_date: 'unlimited'
            }
          : {
              start_date: startDateStr,
              end_date: endDateStr
            },
      message: 'Summary report with discipline analysis generated successfully'
    });
  } catch (error) {
    logger.error(`Error generating summary report with discipline analysis: ${error.message}`, {
      stack: error.stack,
      query: req.query
    });
    next(error);
  }
};

export const getDashboardAnalytics = async (req, res, next) => {
  try {
    const { period = '30d', from = null, to = null } = req.query;
    const data = await buildDashboardAnalytics({ period, from, to });

    return res.status(200).json({
      success: true,
      data,
      message: 'Dashboard analytics retrieved successfully'
    });
  } catch (error) {
    next(error);
  }
};

export default {
  getSummaryReport,
  getDashboardAnalytics
};
