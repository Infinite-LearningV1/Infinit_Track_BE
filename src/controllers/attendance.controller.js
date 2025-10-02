import { Op } from 'sequelize';
import Holidays from 'date-holidays';

import sequelize from '../config/database.js';
import {
  Attendance,
  Booking,
  Location,
  Settings,
  AttendanceCategory,
  AttendanceStatus,
  BookingStatus,
  User,
  Role,
  LocationEvent
} from '../models/index.js';
import {
  calculateDistance,
  getJakartaTime,
  getJakartaDateString,
  getCurrentTimeForDB,
  toJakartaTime
} from '../utils/geofence.js';
import { formatWorkHour, calculateWorkHour, formatTimeOnly } from '../utils/workHourFormatter.js';
import { applySearch } from '../utils/searchHelper.js';
import { triggerAutoCheckout, runSmartAutoCheckoutForDate } from '../jobs/autoCheckout.job.js';
import {
  triggerResolveWfaBookings,
  resolveWfaBookingsForDate
} from '../jobs/resolveWfaBookings.job.js';
import { runGeneralAlphaForDate } from '../jobs/createGeneralAlpha.job.js';
import logger from '../utils/logger.js';
import fuzzyEngine from '../utils/fuzzyAhpEngine.js';
import { extentWeightsTFN } from '../analytics/fahp.extent.js';
import { defuzzifyMatrixTFN, computeCR } from '../analytics/fahp.js';
import { SMART_AC_PAIRWISE_TFN } from '../analytics/config.fahp.js';

export const clockIn = async (req, res) => {
  try {
    const { location } = req.body;
    const userId = req.user.id;

    // Check if user already clocked in today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingAttendance = await Attendance.findOne({
      where: {
        userId,
        clockIn: {
          [Op.gte]: today
        }
      }
    });

    if (existingAttendance) {
      return res.status(400).json({ message: 'Already clocked in today' });
    }

    const attendance = await Attendance.create({
      userId,
      clockIn: new Date(),
      location
    });

    res.status(201).json({ message: 'Clock in successful', attendance });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * Test endpoint to compute checkout prediction using weightedPrediction
 * Admin/Management only
 * Body schema:
 * {
 *   candidates: { HIST?: string|Date, CHECKIN?: string|Date, CONTEXT?: string|Date, TRANSITION?: string|Date },
 *   weights: number[4], // [HIST, CHECKIN, CONTEXT, TRANSITION]
 *   targetDate: string (YYYY-MM-DD),
 *   timeIn: string|Date (ISO),
 *   fallbackEndStr?: string (HH:mm:ss)
 * }
 */
export const testWeightedPrediction = async (req, res) => {
  try {
    const {
      candidates = {},
      weights,
      targetDate,
      timeIn,
      fallbackEndStr = '18:00:00'
    } = req.body || {};

    if (!targetDate || !timeIn) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid body. Required: targetDate (YYYY-MM-DD), timeIn (ISO), candidates object; optional: weights[4]'
      });
    }

    const parseTime = (value, dateStr) => {
      if (!value) return null;
      if (typeof value === 'string') {
        // Accept "HH:mm:ss" or full ISO
        if (/^\d{2}:\d{2}:\d{2}$/.test(value)) {
          return new Date(`${dateStr}T${value}+07:00`);
        }
      }
      return new Date(value);
    };
    const toWIBTimeString = (date) => {
      if (!date) return null;
      const d = toJakartaTime(date);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    };
    const cand = {
      HIST: parseTime(candidates.HIST, targetDate),
      CHECKIN: parseTime(candidates.CHECKIN, targetDate),
      CONTEXT: parseTime(candidates.CONTEXT, targetDate),
      TRANSITION: parseTime(candidates.TRANSITION, targetDate)
    };

    // Determine weights: use provided or default FAHP SMART_AC weights (extent method)
    const defaultWeights = extentWeightsTFN(SMART_AC_PAIRWISE_TFN);
    const W = Array.isArray(weights) && weights.length === 4 ? weights : defaultWeights;

    // Compute CR for diagnostics
    const crisp = defuzzifyMatrixTFN(SMART_AC_PAIRWISE_TFN);
    const { CR } = computeCR(crisp);

    const predicted = fuzzyEngine.weightedPrediction(
      cand,
      W,
      targetDate,
      parseTime(timeIn, targetDate),
      fallbackEndStr
    );

    return res.status(200).json({
      success: true,
      data: {
        input: {
          candidates: {
            HIST: toWIBTimeString(cand.HIST),
            CHECKIN: toWIBTimeString(cand.CHECKIN),
            CONTEXT: toWIBTimeString(cand.CONTEXT),
            TRANSITION: toWIBTimeString(cand.TRANSITION)
          },
          weights: W,
          targetDate,
          timeIn: toWIBTimeString(parseTime(timeIn, targetDate)),
          fallbackEndStr
        },
        result_time: predicted ? toWIBTimeString(predicted) : null,
        CR: parseFloat(CR.toFixed(3)),
        CR_threshold: 0.1,
        is_consistent: CR <= 0.1
      },
      message: 'Smart Auto Checkout weighted prediction'
    });
  } catch (error) {
    logger.error('Error in testWeightedPrediction:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

export const clockOut = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find today's attendance record
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      where: {
        userId,
        clockIn: {
          [Op.gte]: today
        },
        clockOut: null
      }
    });

    if (!attendance) {
      return res.status(400).json({ message: 'No clock in record found for today' });
    }

    await attendance.update({ clockOut: new Date() });

    res.json({ message: 'Clock out successful', attendance });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

export const getAttendanceHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = 'daily', page = 1, limit = 5 } = req.query;

    // Calculate offset for pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Get current Jakarta time
    const now = new Date();
    const jakartaOffset = 7 * 60; // UTC+7 in minutes
    const jakartaTime = new Date(now.getTime() + jakartaOffset * 60000);

    // Determine date range based on period
    let startDate, endDate;
    let whereClause = { user_id: userId };
    switch (period) {
      case 'daily': {
        // Start and end of today
        startDate = new Date(jakartaTime);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(jakartaTime);
        endDate.setHours(23, 59, 59, 999);
        break;
      }

      case 'weekly': {
        // Start of this week (Monday) to end of this week (Sunday)
        const dayOfWeek = jakartaTime.getDay();
        const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Handle Sunday as 0

        startDate = new Date(jakartaTime);
        startDate.setDate(jakartaTime.getDate() + diffToMonday);
        startDate.setHours(0, 0, 0, 0);

        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
        break;
      }

      case 'monthly': {
        // Start and end of current month
        startDate = new Date(jakartaTime.getFullYear(), jakartaTime.getMonth(), 1);
        endDate = new Date(jakartaTime.getFullYear(), jakartaTime.getMonth() + 1, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
      }

      case 'all':
        // No date filter
        break;

      default:
        return res.status(400).json({
          success: false,
          message: 'Period parameter tidak valid. Gunakan: daily, weekly, monthly, atau all'
        });
    } // Add date filter if not 'all'
    if (period !== 'all') {
      whereClause.attendance_date = {
        [Op.between]: [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
      };
    }

    // Run queries in parallel for efficiency
    const [summaryByStatus, summaryByCategory, attendanceData] = await Promise.all([
      // Query 1: Summary by status
      Attendance.findAll({
        where: whereClause,
        attributes: ['status_id', [sequelize.fn('COUNT', sequelize.col('status_id')), 'count']],
        group: ['status_id'],
        raw: true
      }),

      // Query 2: Summary by category
      Attendance.findAll({
        where: whereClause,
        attributes: ['category_id', [sequelize.fn('COUNT', sequelize.col('category_id')), 'count']],
        group: ['category_id'],
        raw: true
      }),

      // Query 3: Detailed attendance list with pagination
      Attendance.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: AttendanceCategory,
            as: 'attendance_category',
            attributes: ['category_name']
          },
          {
            model: AttendanceStatus,
            as: 'status',
            attributes: ['attendance_status_name']
          },
          {
            model: Location,
            as: 'location',
            attributes: ['description'],
            required: false
          }
        ],
        order: [['attendance_date', 'DESC']],
        limit: parseInt(limit),
        offset: offset
      })
    ]); // Process summary data with updated status mapping
    const summary = {
      total_ontime: 0,
      total_late: 0,
      total_early: 0,
      total_alpha: 0,
      total_wfo: 0,
      total_wfa: 0
    }; // Map status counts with dynamic status logic: 1=ontime, 2=late, 4=early, 3=alpha
    summaryByStatus.forEach((item) => {
      const count = parseInt(item.count);

      switch (item.status_id) {
        case 1:
          summary.total_ontime = count;
          break;
        case 2:
          summary.total_late = count;
          break;
        case 4:
          summary.total_early = count;
          break;
        case 3:
          summary.total_alpha = count;
          break;
      }
    });

    // Map category counts (assuming: 1=WFO, 3=WFA)
    summaryByCategory.forEach((item) => {
      const count = parseInt(item.count);

      switch (item.category_id) {
        case 1:
          summary.total_wfo = count;
          break;
        case 3:
          summary.total_wfa = count;
          break;
      }
    }); // Transform attendance data
    const transformedData = attendanceData.rows.map((att) => {
      // Parse attendance date
      const attendanceDate = new Date(att.attendance_date);

      // Format date components
      const day = attendanceDate.getDate().toString().padStart(2, '0');
      const months = [
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec'
      ];
      const month = months[attendanceDate.getMonth()];
      const year = attendanceDate.getFullYear();
      const monthYear = `${month} ${year}`;

      // Extract PredOut from notes if present for history display
      const notesStr = att.notes || '';
      const smartMatch = notesStr.match(/\[Smart AC\]\s*pred=([^,]+),\s*used=([^,]+),/);
      const fallbackMatch = notesStr.match(/\[Fallback AC\]\s*used=([^,]+),/);
      const predOutStr = smartMatch ? smartMatch[1] : fallbackMatch ? fallbackMatch[1] : null;
      // Derive work hour display when DB value is 0 or invalid
      let workHourDisplay = att.work_hour;
      try {
        const rawIn = att.time_in ? new Date(att.time_in) : null;
        const rawOut = att.time_out ? new Date(att.time_out) : null;
        const outBeforeIn = rawIn && rawOut ? rawOut.getTime() < rawIn.getTime() : false;
        if (workHourDisplay == null || workHourDisplay <= 0 || outBeforeIn) {
          if (predOutStr && rawIn) {
            const usedDate = new Date(`${att.attendance_date}T${predOutStr}:00+07:00`);
            workHourDisplay = calculateWorkHour(rawIn, usedDate);
          } else if (rawIn && rawOut) {
            workHourDisplay = calculateWorkHour(rawIn, rawOut);
          }
        }
      } catch (_e) {
        // keep original workHourDisplay
      }

      return {
        id_attendance: att.id_attendance,
        attendance_date: att.attendance_date,
        date: day,
        monthYear: monthYear,
        time_in: formatTimeOnly(att.time_in),
        time_out: formatTimeOnly(att.time_out),
        work_hour: formatWorkHour(workHourDisplay),
        work_hour_raw: workHourDisplay,
        category: att.attendance_category ? att.attendance_category.category_name : null,
        status: att.status ? att.status.attendance_status_name : null,
        location: att.location ? att.location.description : null,
        notes: att.notes
      };
    });

    // Calculate pagination info
    const totalPages = Math.ceil(attendanceData.count / parseInt(limit));

    res.status(200).json({
      success: true,
      data: {
        summary,
        attendances: transformedData,
        pagination: {
          current_page: parseInt(page),
          total_pages: totalPages,
          total_items: attendanceData.count,
          items_per_page: parseInt(limit),
          has_next_page: parseInt(page) < totalPages,
          has_prev_page: parseInt(page) > 1
        }
      },
      message: 'Riwayat absensi berhasil diambil'
    });
  } catch (error) {
    logger.error('Error in getAttendanceHistory:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

export const checkIn = async (req, res, next) => {
  const transaction = await sequelize.transaction();

  try {
    // 1. Get Input Data
    const userId = req.user.id;
    const { category_id, latitude, longitude, notes = '', booking_id } = req.body;

    // Definisikan "Hari Ini" dengan timezone Asia/Jakarta yang benar
    // FIXED V2: Gunakan UTC untuk database, Jakarta time untuk logika
    const jakartaTime = getJakartaTime();
    const localTime = new Date(); // UTC time for database
    const todayDate = getJakartaDateString(); // YYYY-MM-DD format

    // 1. First Layer Validation - Check Duplication
    const existingAttendance = await Attendance.findOne({
      where: {
        user_id: userId,
        attendance_date: todayDate
      },
      transaction
    });

    if (existingAttendance) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Anda sudah melakukan check-in hari ini.'
      });
    } // 2. Get Settings from Database
    const settings = await Settings.findAll({
      where: {
        setting_key: {
          [Op.in]: [
            'checkin.start_time',
            'checkin.end_time',
            'checkin.late_time',
            'workday.holiday_checkin_enabled',
            'workday.weekend_checkin_enabled',
            'workday.holiday_region'
          ]
        }
      },
      transaction
    });

    // Convert settings array ke object untuk kemudahan akses
    const settingsMap = {};
    settings.forEach((setting) => {
      settingsMap[setting.setting_key] = setting.setting_value;
    });

    // Set default values jika setting tidak ditemukan
    const checkinStartTime = settingsMap['checkin.start_time'] || '08:00:00';
    const checkinEndTime = settingsMap['checkin.end_time'] || '18:00:00';
    const lateTime = settingsMap['checkin.late_time'] || '10:00:00';
    const holidayCheckinEnabled = settingsMap['workday.holiday_checkin_enabled'] === 'true';
    const weekendCheckinEnabled = settingsMap['workday.weekend_checkin_enabled'] === 'true';
    const holidayRegion = settingsMap['workday.holiday_region'] || 'ID';

    // 3. Validasi Hari Libur - HANYA untuk WFO (category_id = 1) dan WFH (category_id = 2)
    // WFA (category_id = 3) SKIP validasi ini sepenuhnya
    if (category_id === 1 || category_id === 2) {
      const hd = new Holidays(holidayRegion);
      const isHoliday = hd.isHoliday(localTime);
      const isWeekend = localTime.getDay() === 0 || localTime.getDay() === 6;

      if ((isHoliday && !holidayCheckinEnabled) || (isWeekend && !weekendCheckinEnabled)) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Check-in tidak diizinkan pada hari libur.'
        });
      }
    } // 4. Validasi Jam Kerja
    // Calculate time using proper Jakarta timezone directly from Date object
    const currentHour = jakartaTime.getHours();
    const currentMinute = jakartaTime.getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    const checkinStartMinutes =
      parseInt(checkinStartTime.split(':')[0]) * 60 + parseInt(checkinStartTime.split(':')[1]);
    const checkinEndMinutes =
      parseInt(checkinEndTime.split(':')[0]) * 60 + parseInt(checkinEndTime.split(':')[1]);

    if (currentTimeMinutes < checkinStartMinutes || currentTimeMinutes > checkinEndMinutes) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: `Check-in hanya bisa dilakukan pada jam ${checkinStartTime.substring(0, 5)} - ${checkinEndTime.substring(0, 5)}.`
      });
    } // 5. Core Logic Based on category_id
    let validatedLocationId = null;
    let validatedBookingId = null;

    if (category_id === 1) {
      // WFO (Work From Office)
      // Step A: Get Office Location from Database
      const wfoLocation = await Location.findOne({
        where: {
          id_attendance_categories: 1,
          user_id: null
        },
        transaction
      });

      if (!wfoLocation) {
        await transaction.rollback();
        return res.status(500).json({
          success: false,
          message: 'Konfigurasi lokasi kantor (WFO) tidak ditemukan. Silakan hubungi admin.'
        });
      }

      // Step B: Geofencing Validation
      const distance = calculateDistance(
        parseFloat(latitude),
        parseFloat(longitude),
        parseFloat(wfoLocation.latitude),
        parseFloat(wfoLocation.longitude)
      );

      if (distance > wfoLocation.radius) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Anda berada di luar radius lokasi yang diizinkan.'
        });
      }

      // Step C: Set Location ID
      validatedLocationId = wfoLocation.location_id;
    } else if (category_id === 2) {
      // WFH (Work From Home)
      const wfhLocation = await Location.findOne({
        where: {
          user_id: userId,
          id_attendance_categories: 2
        },
        transaction
      });

      if (!wfhLocation) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Lokasi WFH tidak ditemukan. Silakan hubungi admin.'
        });
      }

      const distance = calculateDistance(
        parseFloat(latitude),
        parseFloat(longitude),
        parseFloat(wfhLocation.latitude),
        parseFloat(wfhLocation.longitude)
      );

      if (distance > wfhLocation.radius) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Anda berada di luar radius lokasi yang diizinkan.'
        });
      }

      validatedLocationId = wfhLocation.location_id;
    } else if (category_id === 3) {
      // WFA (Work From Anywhere)
      if (!booking_id) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Booking ID wajib untuk WFA.'
        });
      }

      const booking = await Booking.findOne({
        where: {
          booking_id: booking_id
        },
        include: [
          {
            model: Location,
            as: 'location'
          }
        ],
        transaction
      });

      if (!booking) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Booking tidak ditemukan.'
        });
      }

      // Additional validations for WFA booking
      if (booking.user_id !== userId) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Booking tidak valid untuk user ini.'
        });
      }

      if (booking.status !== 1) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Booking belum disetujui.'
        });
      }

      if (booking.schedule_date !== todayDate) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Booking tidak berlaku untuk hari ini.'
        });
      } // Geofencing validation for WFA location
      const distance = calculateDistance(
        parseFloat(latitude),
        parseFloat(longitude),
        parseFloat(booking.location.latitude),
        parseFloat(booking.location.longitude)
      );

      if (distance > booking.location.radius) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Anda berada di luar radius lokasi yang diizinkan.'
        });
      }

      validatedLocationId = booking.location.location_id;
      validatedBookingId = booking_id;
    } // 6. Determine Attendance Status Dynamically (early, ontime, late)
    const lateTimeMinutes =
      parseInt(lateTime.split(':')[0]) * 60 + parseInt(lateTime.split(':')[1]);

    let determinedStatusId;
    let statusLabel;

    // Logika penentuan status berdasarkan aturan dinamis dari database:
    if (currentTimeMinutes < checkinStartMinutes) {
      // Early: waktu check-in < checkin.start_time
      determinedStatusId = 4; // Early status (sesuai dengan prasyarat tabel attendance_statuses)
      statusLabel = 'EARLY';
      logger.info(
        `Check-in classified as EARLY: ${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')} < ${checkinStartTime}`
      );
    } else if (currentTimeMinutes > lateTimeMinutes) {
      // Late: waktu check-in > checkin.late_time
      determinedStatusId = 2; // Late status
      statusLabel = 'LATE';
      logger.info(
        `Check-in classified as LATE: ${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')} > ${lateTime}`
      );
    } else {
      // On Time: between start_time and late_time
      determinedStatusId = 1; // On time status
      statusLabel = 'ON TIME';
      logger.info(
        `Check-in classified as ON TIME: ${checkinStartTime} <= ${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')} <= ${lateTime}`
      );
    }

    // 7. Save Data to Database dengan status yang telah ditentukan secara dinamis
    // FIXED: Always use WIB time for database storage
    const wibTimeForDB = getCurrentTimeForDB(); // Force WIB timezone

    const attendanceData = {
      user_id: userId,
      category_id: category_id,
      status_id: determinedStatusId, // <-- GUNAKAN VARIABEL HASIL LOGIKA DINAMIS
      location_id: validatedLocationId, // This will contain actual location_id for WFO
      booking_id: validatedBookingId,
      time_in: wibTimeForDB, // SAVE WIB TIME
      attendance_date: todayDate,
      notes: notes,
      created_at: wibTimeForDB, // SAVE WIB TIME
      updated_at: wibTimeForDB // SAVE WIB TIME
    };

    const newAttendance = await Attendance.create(attendanceData, { transaction });
    await transaction.commit();

    // 8. Send Success Response dengan informasi status yang telah ditentukan
    res.status(201).json({
      success: true,
      data: {
        ...newAttendance.toJSON(),
        status_classification: {
          status_id: determinedStatusId,
          status_label: statusLabel,
          check_in_time: `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`,
          time_rules: {
            start_time: checkinStartTime,
            late_time: lateTime
          }
        }
      },
      message: `Check-in berhasil dengan status: ${statusLabel}`
    });
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
};

// Debug endpoint untuk troubleshooting check-in time validation
export const debugCheckInTime = async (req, res) => {
  try {
    // Get current Jakarta time with proper timezone handling
    const today = new Date();
    const localTime = new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const todayDate = localTime.toISOString().split('T')[0];

    // Simple test first
    const testHour = localTime.getHours();
    const testMinute = localTime.getMinutes();

    console.log('=== DEBUG TIMEZONE TEST ===');
    console.log('Raw UTC time:', today.toISOString());
    console.log('Raw local time:', today.toString());
    console.log('Jakarta time calculated:', localTime.toISOString());
    console.log('Test extracted hour:', testHour);
    console.log('Test extracted minute:', testMinute);
    console.log('=== END DEBUG ===');

    // Get settings from database
    const settings = await Settings.findAll({
      where: {
        setting_key: {
          [Op.in]: [
            'checkin.start_time',
            'checkin.end_time',
            'checkin.late_time',
            'checkout.auto_time',
            'workday.holiday_checkin_enabled',
            'workday.weekend_checkin_enabled',
            'workday.holiday_region'
          ]
        }
      }
    });

    // Convert settings
    const settingsMap = {};
    settings.forEach((setting) => {
      settingsMap[setting.setting_key] = setting.setting_value;
    });

    const checkinStartTime = settingsMap['checkin.start_time'] || '08:00:00';
    const checkinEndTime = settingsMap['checkin.end_time'] || '18:00:00';
    const lateTime = settingsMap['checkin.late_time'] || '10:00:00';

    // Calculate time in minutes using proper Jakarta timezone
    const currentHour = localTime.getHours();
    const currentMinute = localTime.getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    console.log('DEBUG TIMEZONE:');
    console.log('today (UTC):', today.toISOString());
    console.log('localTime (Jakarta):', localTime.toISOString());
    console.log('localTime string:', localTime.toString());
    console.log('extracted hour:', currentHour);
    console.log('extracted minute:', currentMinute);

    const checkinStartMinutes =
      parseInt(checkinStartTime.split(':')[0]) * 60 + parseInt(checkinStartTime.split(':')[1]);
    const checkinEndMinutes =
      parseInt(checkinEndTime.split(':')[0]) * 60 + parseInt(checkinEndTime.split(':')[1]);

    const isWithinWindow =
      currentTimeMinutes >= checkinStartMinutes && currentTimeMinutes <= checkinEndMinutes;

    res.json({
      success: true,
      debug_info: {
        current_utc_time: today.toISOString(),
        current_jakarta_time: localTime.toISOString(),
        today_date: todayDate,
        current_hour: currentHour,
        current_minute: currentMinute,
        current_time_minutes: currentTimeMinutes,
        test_hour: testHour,
        test_minute: testMinute,
        settings_from_db: settingsMap,
        calculated_values: {
          checkin_start_time: checkinStartTime,
          checkin_end_time: checkinEndTime,
          late_time: lateTime,
          checkin_start_minutes: checkinStartMinutes,
          checkin_end_minutes: checkinEndMinutes
        },
        validation: {
          is_within_checkin_window: isWithinWindow,
          too_early: currentTimeMinutes < checkinStartMinutes,
          too_late: currentTimeMinutes > checkinEndMinutes
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Debug error',
      error: error.message
    });
  }
};

export const getAttendanceStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Effective time input: prioritize query ?now, then header X-Client-Now; fallback to server Jakarta time
    let effectiveNow = null;
    const nowQuery = req.query?.now;
    const nowHeader = req.headers['x-client-now'];
    if (nowQuery) {
      const parsed = new Date(nowQuery);
      if (!isNaN(parsed.getTime())) effectiveNow = parsed;
    }
    if (!effectiveNow && nowHeader) {
      const parsed = new Date(Array.isArray(nowHeader) ? nowHeader[0] : nowHeader);
      if (!isNaN(parsed.getTime())) effectiveNow = parsed;
    }
    if (!effectiveNow) {
      const now = new Date();
      effectiveNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    }
    const todayDate = effectiveNow.toISOString().split('T')[0]; // YYYY-MM-DD
    const settings = await Settings.findAll({
      where: {
        setting_key: {
          [Op.in]: [
            'checkin.start_time',
            'checkin.end_time',
            'checkout.auto_time',
            'workday.holiday_checkin_enabled',
            'workday.holiday_region'
          ]
        }
      }
    });

    // Convert settings array ke object untuk kemudahan akses
    const settingsMap = {};
    settings.forEach((setting) => {
      settingsMap[setting.setting_key] = setting.setting_value;
    }); // Set default values jika setting tidak ditemukan
    const checkinStartTime = settingsMap['checkin.start_time'] || '08:00:00';
    const checkinEndTime = settingsMap['checkin.end_time'] || '18:00:00';
    const checkoutAutoTime = settingsMap['checkout.auto_time'] || '17:00:00';
    const holidayCheckinEnabled = settingsMap['workday.holiday_checkin_enabled'] === 'true';
    const holidayRegion = settingsMap['workday.holiday_region'] || 'ID'; // Indonesia

    // Cek hari libur menggunakan date-holidays
    const hd = new Holidays(holidayRegion);
    const isHoliday = hd.isHoliday(effectiveNow);
    const isWeekend = effectiveNow.getDay() === 0 || effectiveNow.getDay() === 6; // Sunday = 0, Saturday = 6
    const isHolidayOrWeekend = isHoliday || isWeekend;

    // Cek absensi hari ini
    const currentAttendance = await Attendance.findOne({
      where: {
        user_id: userId,
        attendance_date: todayDate
      },
      include: [
        {
          model: Location,
          as: 'location',
          include: [
            {
              model: AttendanceCategory,
              as: 'attendance_category'
            }
          ]
        }
      ]
    });

    // Cek booking WFA hari ini
    const todayBooking = await Booking.findOne({
      where: {
        user_id: userId,
        schedule_date: todayDate,
        status: 1 // approved (berdasarkan booking_status table)
      },
      include: [
        {
          model: Location,
          as: 'location',
          include: [
            {
              model: AttendanceCategory,
              as: 'attendance_category'
            }
          ]
        },
        {
          model: BookingStatus,
          as: 'booking_status'
        }
      ]
    }); // Tentukan active_mode dan active_location
    let active_mode, active_location;

    if (todayBooking) {
      active_mode = 'Work From Anywhere';
      active_location = {
        location_id: todayBooking.location.location_id,
        latitude: parseFloat(todayBooking.location.latitude),
        longitude: parseFloat(todayBooking.location.longitude),
        radius: todayBooking.location.radius,
        description: todayBooking.location.description,
        category: todayBooking.location.attendance_category.category_name
      };
    } else {
      // Get WFO location from database
      const wfoLocation = await Location.findOne({
        where: {
          id_attendance_categories: 1,
          user_id: null
        }
      });

      if (wfoLocation) {
        active_mode = 'Work From Office';
        active_location = {
          location_id: wfoLocation.location_id,
          latitude: parseFloat(wfoLocation.latitude),
          longitude: parseFloat(wfoLocation.longitude),
          radius: wfoLocation.radius,
          description: wfoLocation.description,
          address: wfoLocation.address,
          category: 'Work From Office'
        };
      } else {
        // Fallback to hardcoded values if WFO location not found in database
        active_mode = 'Work From Office';
        active_location = {
          location_id: null,
          latitude: -6.2088,
          longitude: 106.8456,
          radius: 100,
          description: 'Kantor Pusat Jakarta',
          address: 'Jl. Sudirman No. 1, Jakarta Pusat',
          category: 'Work From Office'
        };
      }
    } // Tentukan waktu check-in yang diizinkan (08:00 - 18:00)
    // Calculate time using effective time
    const currentHour = effectiveNow.getHours();
    const currentMinute = effectiveNow.getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    const checkinStartMinutes =
      parseInt(checkinStartTime.split(':')[0]) * 60 + parseInt(checkinStartTime.split(':')[1]);
    const checkinEndMinutes =
      parseInt(checkinEndTime.split(':')[0]) * 60 + parseInt(checkinEndTime.split(':')[1]);

    // Tentukan can_check_in
    // For WFA mode (booking approved today), ignore holiday/weekend gating; use time window only
    const isWfaMode = active_mode === 'Work From Anywhere';
    const can_check_in =
      !currentAttendance &&
      currentTimeMinutes >= checkinStartMinutes &&
      currentTimeMinutes <= checkinEndMinutes &&
      (isWfaMode || !isHolidayOrWeekend || holidayCheckinEnabled);

    // Tentukan can_check_out
    const can_check_out = currentAttendance && !currentAttendance.time_out; // Bentuk respons
    const response = {
      success: true,
      data: {
        can_check_in,
        can_check_out,
        checked_in_at: currentAttendance ? formatTimeOnly(currentAttendance.time_in) : null,
        checked_out_at:
          currentAttendance && currentAttendance.time_out
            ? formatTimeOnly(currentAttendance.time_out)
            : null,
        active_mode,
        active_location,
        today_date: todayDate,
        is_holiday: isHolidayOrWeekend,
        holiday_checkin_enabled: holidayCheckinEnabled,
        current_time: effectiveNow.toISOString(),
        checkin_window: {
          start_time: checkinStartTime,
          end_time: checkinEndTime
        },
        checkout_auto_time: checkoutAutoTime
      }
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

export const checkOut = async (req, res, next) => {
  const transaction = await sequelize.transaction();

  try {
    // 1. Dapatkan Input
    const attendanceId = req.params.id;
    const userId = req.user.id;
    const { latitude, longitude } = req.body;

    // 2. Validasi Awal - Cari attendance record
    const attendance = await Attendance.findByPk(attendanceId, { transaction });

    if (!attendance) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Data attendance tidak ditemukan'
      });
    }

    // Pastikan attendance milik user yang sedang login
    if (attendance.user_id !== userId) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki akses untuk melakukan check-out pada data ini'
      });
    }

    // Pastikan belum melakukan check-out
    if (attendance.time_out !== null) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Anda sudah melakukan check-out hari ini.'
      });
    }

    // 3. Validasi Lokasi Fleksibel
    const validLocations = [];

    // Ambil Lokasi WFO (kantor - id = 1)
    const wfoLocation = await Location.findOne({
      where: {
        id_attendance_categories: 1,
        user_id: null
      },
      transaction
    });

    if (wfoLocation) {
      validLocations.push(wfoLocation);
    }

    // Ambil Lokasi WFH untuk user ini
    const wfhLocation = await Location.findOne({
      where: {
        id_attendance_categories: 2,
        user_id: userId
      },
      transaction
    });

    if (wfhLocation) {
      validLocations.push(wfhLocation);
    }

    // Ambil Lokasi WFA Aktif (booking yang approved untuk hari ini)
    const today = new Date();
    const jakartaOffset = 7 * 60; // UTC+7 dalam menit
    const localTime = new Date(today.getTime() + jakartaOffset * 60000);
    const todayDate = localTime.toISOString().split('T')[0]; // YYYY-MM-DD format

    const activeBooking = await Booking.findOne({
      where: {
        user_id: userId,
        status: 2, // status approved (assuming 2 is approved)
        schedule_date: todayDate
      },
      include: [
        {
          model: Location,
          as: 'location',
          required: true
        }
      ],
      transaction
    });

    if (activeBooking && activeBooking.location) {
      validLocations.push(activeBooking.location);
    }

    // Validasi jarak dengan semua lokasi valid
    let isWithinRadius = false;

    for (const location of validLocations) {
      const distance = calculateDistance(
        parseFloat(latitude),
        parseFloat(longitude),
        parseFloat(location.latitude),
        parseFloat(location.longitude)
      );

      const allowedRadius = location.radius || 100; // default 100 meter

      if (distance <= allowedRadius) {
        isWithinRadius = true;
        break;
      }
    }

    if (!isWithinRadius) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Anda berada di luar radius lokasi yang diizinkan untuk check-out.'
      });
    } // 4. Update Database
    // FIXED V7: Ensure timezone consistency for work hour calculation
    const timeOut = getCurrentTimeForDB(); // UTC time

    // CRITICAL FIX: Ensure both timeIn and timeOut are in the same timezone format
    // attendance.time_in from database is a string like "2025-07-08 21:54:24"
    // We need to parse it correctly as WIB timezone
    let timeInForCalculation;

    if (typeof attendance.time_in === 'string') {
      // Parse database string as WIB timezone (+07:00)
      timeInForCalculation = new Date(attendance.time_in + '+07:00');
    } else {
      // If it's already a Date object, use it directly
      timeInForCalculation = new Date(attendance.time_in);
    }

    // Use the dedicated calculateWorkHour function from workHourFormatter
    const workHour = calculateWorkHour(timeInForCalculation, timeOut);

    // DEBUG: Log the values before calculation
    console.log('=== WORK HOUR CALCULATION DEBUG V7 ===');
    console.log('attendance.time_in (raw from DB):', attendance.time_in);
    console.log('timeInForCalculation (parsed with timezone):', timeInForCalculation);
    console.log('timeOut (current UTC):', timeOut);
    console.log('Final workHour calculated:', workHour);
    console.log('Final workHour formatted:', formatWorkHour(workHour));

    // Update attendance record
    await attendance.update(
      {
        time_out: timeOut,
        work_hour: workHour
      },
      { transaction }
    );

    await transaction.commit();

    // Fetch fresh data from database to ensure updated values
    const updatedAttendance = await Attendance.findByPk(attendanceId);

    // Debug logging
    console.log('=== CHECKOUT DEBUG ===');
    console.log('Raw time_in from DB:', updatedAttendance.time_in);
    console.log('Raw time_out from DB:', updatedAttendance.time_out);
    console.log('formatTimeOnly(time_in):', formatTimeOnly(updatedAttendance.time_in));
    console.log('formatTimeOnly(time_out):', formatTimeOnly(updatedAttendance.time_out));

    // 5. Kirim Respons Sukses
    res.status(200).json({
      success: true,
      data: {
        id_attendance: updatedAttendance.id_attendance,
        attendance_date: updatedAttendance.attendance_date,
        time_in: formatTimeOnly(updatedAttendance.time_in),
        time_out: formatTimeOnly(updatedAttendance.time_out),
        work_hour: formatWorkHour(updatedAttendance.work_hour),
        user_id: updatedAttendance.user_id,
        category_id: updatedAttendance.category_id,
        status_id: updatedAttendance.status_id,
        location_id: updatedAttendance.location_id,
        booking_id: updatedAttendance.booking_id,
        notes: updatedAttendance.notes
      },
      message: 'Check-out berhasil'
    });
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
};

export const deleteAttendance = async (req, res, next) => {
  try {
    // Langkah 1: Dapatkan ID dari Parameter URL
    const { id } = req.params;

    // Langkah 2: Cari Record Absensi
    const attendanceRecord = await Attendance.findByPk(id);

    // Langkah 3: Handle Jika Data Tidak Ditemukan
    if (!attendanceRecord) {
      return res.status(404).json({
        success: false,
        message: 'Data absensi tidak ditemukan.'
      });
    }

    // Langkah 4: Lakukan Hard Delete
    await attendanceRecord.destroy();

    // Langkah 5: Kirim Respons Sukses
    res.status(200).json({
      success: true,
      message: 'Data absensi berhasil dihapus.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all attendances for admin/management with search, pagination and sorting
 * Protected route for admin and management roles only
 */
export const getAllAttendances = async (req, res, next) => {
  try {
    // Get query parameters with defaults
    const { search, page = 1, limit = 10 } = req.query;

    // Validate pagination parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    if (pageNum < 1 || limitNum < 1) {
      return res.status(400).json({
        success: false,
        message: 'Parameter page dan limit harus berupa angka positif'
      });
    }

    // Calculate offset for pagination
    const offset = (pageNum - 1) * limitNum;

    // Build query options
    const queryOptions = {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id_users', 'full_name', 'nip_nim', 'email'],
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
          required: false
        },
        {
          model: AttendanceStatus,
          as: 'status',
          attributes: ['attendance_status_name']
        },
        {
          model: AttendanceCategory,
          as: 'attendance_category',
          attributes: ['category_name']
        }
      ],
      order: [['id_attendance', 'DESC']],
      limit: limitNum,
      offset: offset,
      distinct: true // Important for correct count with includes
    };

    // Apply search if provided
    if (search && search.trim()) {
      applySearch(queryOptions, search, ['$user.full_name$', '$user.nip_nim$']);
    }

    // Execute query
    const { count, rows } = await Attendance.findAndCountAll(queryOptions);

    // Transform data response
    const transformedData = rows.map((att) => {
      // Format work hour using utility
      const formattedWorkHour = formatWorkHour(att.work_hour);

      return {
        id_attendance: att.id_attendance,
        id: att.user?.id_users || null,
        full_name: att.user?.full_name || 'Unknown User',
        nip_nim: att.user?.nip_nim || null,
        role_name: att.user?.role?.role_name || null,
        time_in: formatTimeOnly(att.time_in),
        time_out: formatTimeOnly(att.time_out),
        work_hour: formattedWorkHour,
        attendance_date: att.attendance_date,
        location: att.location
          ? {
              location_id: att.location.location_id,
              description: att.location.description,
              latitude: parseFloat(att.location.latitude),
              longitude: parseFloat(att.location.longitude)
            }
          : null,
        status: att.status?.attendance_status_name || 'Unknown',
        information: att.attendance_category?.category_name || 'Unknown',
        notes: att.notes
      };
    });

    // Calculate pagination info
    const totalPages = Math.ceil(count / limitNum);

    // Send success response
    res.status(200).json({
      success: true,
      message: 'Data absensi berhasil diambil',
      data: transformedData,
      pagination: {
        current_page: pageNum,
        total_pages: totalPages,
        total_records: count,
        records_per_page: limitNum,
        has_next_page: pageNum < totalPages,
        has_prev_page: pageNum > 1
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Manual trigger for automatic checkout (for testing purposes)
 * This endpoint allows admins to manually trigger the auto checkout process
 */
export const manualAutoCheckout = async (req, res, next) => {
  try {
    // Only allow admins to trigger manual auto checkout
    if (req.user.role_name !== 'Admin' && req.user.role_name !== 'Management') {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Hanya admin dan manajemen yang dapat memicu auto checkout manual.'
      });
    }

    // Trigger the auto checkout job
    await triggerAutoCheckout();

    res.status(200).json({
      success: true,
      message: 'Auto checkout manual berhasil dipicu. Periksa log untuk detail hasil.',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get auto checkout settings (for debugging/testing)
 */
export const getAutoCheckoutSettings = async (req, res, next) => {
  try {
    // Get the auto checkout time setting from database
    const autoTimeSetting = await Settings.findOne({
      where: {
        setting_key: 'checkout.auto_time'
      }
    });

    // Get current Jakarta time
    const now = new Date();
    const jakartaOffset = 7 * 60; // UTC+7 in minutes
    const jakartaTime = new Date(now.getTime() + jakartaOffset * 60000);
    const currentTimeString = jakartaTime.toISOString().substring(11, 19);
    const currentDate = jakartaTime.toISOString().split('T')[0];

    // Find active attendances (checked in but not checked out)
    const activeAttendances = await Attendance.findAll({
      where: {
        attendance_date: currentDate,
        time_out: null
      },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id_users', 'full_name', 'nip_nim']
        }
      ]
    });

    res.status(200).json({
      success: true,
      data: {
        auto_checkout_time: autoTimeSetting?.setting_value || 'Not configured',
        current_jakarta_time: currentTimeString,
        current_date: currentDate,
        active_attendances_count: activeAttendances.length,
        active_attendances: activeAttendances.map((att) => ({
          id_attendance: att.id_attendance,
          user_id: att.user_id,
          user_name: att.user?.full_name,
          time_in: formatTimeOnly(att.time_in),
          attendance_date: att.attendance_date
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Manual trigger for resolve unused WFA bookings job (Admin only)
 * This endpoint allows admins to manually trigger the WFA bookings resolver
 * for testing purposes or to handle missed daily runs
 */
export const manualResolveWfaBookings = async (req, res, next) => {
  try {
    // Only allow admins to trigger manual resolve
    if (req.user.role_name !== 'Admin' && req.user.role_name !== 'Management') {
      return res.status(403).json({
        success: false,
        message:
          'Akses ditolak. Hanya admin dan manajemen yang dapat menjalankan resolve WFA bookings secara manual.'
      });
    }

    const result = await triggerResolveWfaBookings();

    res.status(200).json({
      success: true,
      message: 'Resolve unused WFA bookings job berhasil dijalankan secara manual.',
      data: result
    });
  } catch (error) {
    logger.error('Error in manual resolve WFA bookings:', error);
    next(error);
  }
};

/**
 * Test trigger: General Alpha for a specific date (Admin only)
 * POST /api/attendance/manual-general-alpha
 * Body: { target_date: 'YYYY-MM-DD' }
 */
export const manualGeneralAlphaForDate = async (req, res, next) => {
  try {
    if (req.user.role_name !== 'Admin' && req.user.role_name !== 'Management') {
      return res.status(403).json({ success: false, message: 'Akses ditolak.' });
    }
    const rawTarget =
      (req.body && req.body.target_date) ||
      (req.query && req.query.target_date) ||
      (req.params && req.params.target_date) ||
      null;
    const target_date = typeof rawTarget === 'string' ? rawTarget.trim() : rawTarget;
    if (!target_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(target_date))) {
      return res.status(400).json({ success: false, message: 'target_date harus YYYY-MM-DD' });
    }
    const result = await runGeneralAlphaForDate(target_date);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * Test trigger: WFA Alpha resolver for a specific date (Admin only)
 * POST /api/attendance/manual-resolve-wfa-for-date
 * Body: { target_date: 'YYYY-MM-DD' }
 */
export const manualResolveWfaForDate = async (req, res, next) => {
  try {
    if (req.user.role_name !== 'Admin' && req.user.role_name !== 'Management') {
      return res.status(403).json({ success: false, message: 'Akses ditolak.' });
    }
    const rawTarget =
      (req.body && req.body.target_date) ||
      (req.query && req.query.target_date) ||
      (req.params && req.params.target_date) ||
      null;
    const target_date = typeof rawTarget === 'string' ? rawTarget.trim() : rawTarget;
    if (!target_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(target_date))) {
      return res.status(400).json({ success: false, message: 'target_date harus YYYY-MM-DD' });
    }
    const result = await resolveWfaBookingsForDate(target_date);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * Test trigger: Smart Auto Checkout for specific date (Admin only)
 * POST /api/attendance/manual-smart-auto-checkout
 * Body: { target_date: 'YYYY-MM-DD' }
 */
export const manualSmartAutoCheckoutForDate = async (req, res, next) => {
  try {
    if (req.user.role_name !== 'Admin' && req.user.role_name !== 'Management') {
      return res.status(403).json({ success: false, message: 'Akses ditolak.' });
    }
    const rawTarget =
      (req.body && req.body.target_date) ||
      (req.query && req.query.target_date) ||
      (req.params && req.params.target_date) ||
      null;
    const target_date = typeof rawTarget === 'string' ? rawTarget.trim() : rawTarget;
    if (!target_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(target_date))) {
      return res.status(400).json({ success: false, message: 'target_date harus YYYY-MM-DD' });
    }
    await runSmartAutoCheckoutForDate(target_date);
    res.status(200).json({ success: true, message: 'Smart Auto Checkout executed', target_date });
  } catch (error) {
    next(error);
  }
};

/**
 * Manual trigger for create general alpha records job (Admin only)
 * This endpoint allows admins to manually trigger the general alpha creator
 * for testing purposes or to handle missed daily runs
 */
// Removed legacy manualCreateGeneralAlpha in favor of date-specific trigger

/**
 * Log location event - lightweight endpoint for recording geofence enter/exit events
 * This endpoint is designed to be fast and efficient for passive Android app tracking
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
export const logLocationEvent = async (req, res, next) => {
  try {
    const { event_type, location_id, event_timestamp } = req.body;
    const user_id = req.user.id; // Get user_id from verified JWT token

    logger.info(
      `Logging location event for user ${user_id}: ${event_type} at location ${location_id} at ${event_timestamp}`
    );

    // Verify that the location exists before creating the event
    const location = await Location.findByPk(location_id);
    if (!location) {
      return res.status(400).json({
        success: false,
        message: 'Location ID tidak valid',
        error: 'INVALID_LOCATION_ID'
      });
    }

    // Parse event timestamp and handle timezone conversion
    const eventDateTime = new Date(event_timestamp);

    // Validate that the event timestamp is valid
    if (isNaN(eventDateTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Format timestamp tidak valid',
        error: 'INVALID_TIMESTAMP'
      });
    }

    // Convert to Jakarta timezone for date comparison
    // Use Intl.DateTimeFormat to get the date in Jakarta timezone
    const jakartaFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const eventDate = jakartaFormatter.format(eventDateTime);

    logger.info(`Event date for attendance lookup (Jakarta timezone): ${eventDate}`);

    // Check if the user has an active attendance session for the event date
    const activeAttendance = await Attendance.findOne({
      where: {
        user_id,
        attendance_date: eventDate
      }
    });

    // Validate that user has an active attendance session (checked-in but not checked-out)
    if (!activeAttendance) {
      return res.status(400).json({
        success: false,
        message:
          'Tidak dapat mencatat lokasi event: Anda belum melakukan check-in pada tanggal tersebut',
        error: 'NO_ACTIVE_SESSION'
      });
    }

    if (activeAttendance.check_out_time) {
      return res.status(400).json({
        success: false,
        message:
          'Tidak dapat mencatat lokasi event: Anda sudah melakukan check-out pada tanggal tersebut',
        error: 'SESSION_ALREADY_ENDED'
      });
    }

    // Create the location event record
    // Sequelize will handle timezone conversion based on the database config
    const locationEvent = await LocationEvent.create({
      user_id,
      location_id,
      event_type,
      event_timestamp: eventDateTime
    });

    logger.info(`Location event created successfully: ID ${locationEvent.id} for user ${user_id}`);

    // Get current time in Jakarta timezone for recorded_at
    const now = new Date();
    const jakartaRecordedAt =
      new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3
      })
        .format(now)
        .replace(' ', 'T') + '+07:00';

    // Return success response with consistent timezone handling
    res.status(201).json({
      success: true,
      message: 'Location event berhasil dicatat',
      data: {
        event_id: locationEvent.id,
        user_id: locationEvent.user_id,
        location_id: locationEvent.location_id,
        event_type: locationEvent.event_type,
        event_timestamp: locationEvent.event_timestamp,
        recorded_at: jakartaRecordedAt
      }
    });
  } catch (error) {
    logger.error('Error in logLocationEvent:', error);

    // Return appropriate error response
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Data tidak valid',
        error: 'VALIDATION_ERROR',
        details: error.errors.map((err) => err.message)
      });
    }

    if (error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({
        success: false,
        message: 'Location ID tidak ditemukan',
        error: 'FOREIGN_KEY_CONSTRAINT'
      });
    }

    next(error);
  }
};

/**
 * Get smart checkout engine configuration and weights (Admin/Management only)
 */
export const getSmartEngineConfig = async (req, res, next) => {
  try {
    // Only allow admins to access configuration
    if (req.user.role_name !== 'Admin' && req.user.role_name !== 'Management') {
      return res.status(403).json({
        success: false,
        message:
          'Akses ditolak. Hanya admin dan manajemen yang dapat mengakses konfigurasi smart checkout.'
      });
    }

    // Feature deprecated in FAHP refactor - only flagger configuration is returned
    const toleranceMin = parseInt(process.env.LATE_CHECKOUT_TOLERANCE_MIN || '120', 10);
    const defaultShiftEnd = process.env.DEFAULT_SHIFT_END || '17:00:00';

    res.status(200).json({
      success: true,
      data: {
        engine_status: 'REMOVED',
        message: 'Checkout prediction removed; using missed-checkout flagger.',
        flagger_config: {
          late_checkout_tolerance_min: toleranceMin,
          default_shift_end: defaultShiftEnd,
          timezone: 'Asia/Jakarta'
        },
        methodology: 'No FIS; FAHP not used for checkout. Rule-based flag by time tolerance.'
      }
    });
  } catch (error) {
    logger.error('Error getting smart checkout configuration:', error);
    next(error);
  }
};

/**
 * Enhanced auto checkout settings with smart prediction preview
 */
export const getEnhancedAutoCheckoutSettings = async (req, res, next) => {
  try {
    // Get the auto checkout time setting from database
    const autoTimeSetting = await Settings.findOne({
      where: {
        setting_key: 'checkout.auto_time'
      }
    });

    // Get current Jakarta time
    const now = new Date();
    const jakartaOffset = 7 * 60; // UTC+7 in minutes
    const jakartaTime = new Date(now.getTime() + jakartaOffset * 60000);
    const currentTimeString = jakartaTime.toISOString().substring(11, 19);
    const currentDate = jakartaTime.toISOString().split('T')[0];

    // Find active attendances (checked in but not checked out)
    const activeAttendances = await Attendance.findAll({
      where: {
        attendance_date: currentDate,
        time_out: null
      },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id_users', 'full_name', 'nip_nim']
        }
      ]
    });

    // Generate smart predictions for active attendances
    const smartPredictions = [];
    for (const attendance of activeAttendances) {
      try {
        const timeIn = new Date(attendance.time_in);
        // const checkinHours = timeIn.getHours() + timeIn.getMinutes() / 60;

        // Get user's historical pattern
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

        const userAttendances = await Attendance.findAll({
          where: {
            user_id: attendance.user_id,
            attendance_date: {
              [Op.gte]: oneMonthAgo.toISOString().split('T')[0]
            },
            time_in: { [Op.not]: null },
            time_out: { [Op.not]: null }
          },
          limit: 10
        });

        let historicalHours = 8.0;
        if (userAttendances.length > 0) {
          const totalHours = userAttendances.reduce((sum, att) => {
            const tIn = new Date(att.time_in);
            const tOut = new Date(att.time_out);
            const hours = (tOut - tIn) / (1000 * 60 * 60);
            return sum + hours;
          }, 0);
          historicalHours = totalHours / userAttendances.length;
        }
        // Smart prediction removed; provide info using fallback time
        const fallback = '17:00:00';
        const [hours, minutes, seconds] = fallback.split(':').map(Number);
        const predictedCheckoutTime = new Date(timeIn);
        predictedCheckoutTime.setHours(hours, minutes, seconds || 0, 0);
        // Record info (duration omitted after FAHP refactor)
        smartPredictions.push({
          attendance_id: attendance.id_attendance,
          user_id: attendance.user_id,
          user_name: attendance.user?.full_name,
          time_in: formatTimeOnly(attendance.time_in),
          predicted_checkout: formatTimeOnly(predictedCheckoutTime),
          predicted_duration: null,
          historical_avg: historicalHours.toFixed(2)
        });
      } catch (error) {
        logger.error(
          `Error generating prediction for attendance ${attendance.id_attendance}:`,
          error
        );
        smartPredictions.push({
          attendance_id: attendance.id_attendance,
          user_id: attendance.user_id,
          user_name: attendance.user?.full_name,
          time_in: formatTimeOnly(attendance.time_in),
          prediction_error: 'Failed to generate prediction'
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        auto_checkout_time: autoTimeSetting?.setting_value || 'Not configured',
        current_jakarta_time: currentTimeString,
        current_date: currentDate,
        active_attendances_count: activeAttendances.length,
        smart_predictions: smartPredictions,
        traditional_checkouts: activeAttendances.map((att) => ({
          id_attendance: att.id_attendance,
          user_id: att.user_id,
          user_name: att.user?.full_name,
          time_in: formatTimeOnly(att.time_in),
          attendance_date: att.attendance_date,
          traditional_checkout: autoTimeSetting?.setting_value || '17:00:00'
        }))
      }
    });
  } catch (error) {
    logger.error('Error getting enhanced auto checkout settings:', error);
    next(error);
  }
};

/**
 * Test endpoint untuk verifikasi timezone fix
 * Debug endpoint untuk memastikan timezone Jakarta bekerja dengan benar
 */
export const testTimezone = async (req, res) => {
  try {
    const now = new Date(); // UTC time
    const jakartaTime = getJakartaTime();

    // Simulasi check-in/out menggunakan UTC time (seperti yang disimpan di database)
    const sampleCheckInUTC = now; // UTC time for database
    const sampleCheckOutUTC = new Date(now.getTime() + 65 * 60 * 1000); // +65 minutes

    res.json({
      success: true,
      message: 'Timezone test results - DEBUGGING UTC to Jakarta conversion',
      data: {
        server_utc_time: now.toISOString(),
        jakarta_time_calculated: jakartaTime.toISOString(),
        jakarta_date_string: getJakartaDateString(),
        current_jakarta_time_formatted: formatTimeOnly(now), // Format UTC time to Jakarta
        simulation: {
          check_in_time: sampleCheckInUTC.toISOString(), // What gets saved to DB (UTC)
          check_in_formatted: formatTimeOnly(sampleCheckInUTC), // How it gets displayed (Jakarta)
          check_out_time: sampleCheckOutUTC.toISOString(),
          check_out_formatted: formatTimeOnly(sampleCheckOutUTC),
          work_hour_calculated: calculateWorkHour(sampleCheckInUTC, sampleCheckOutUTC),
          work_hour_formatted: formatWorkHour(
            calculateWorkHour(sampleCheckInUTC, sampleCheckOutUTC)
          )
        },
        timezone_info: {
          jakarta_offset: '+07:00',
          timezone_method: 'UTC storage + Jakarta display conversion',
          current_fix: 'formatTimeOnly now converts UTC to Jakarta timezone using toLocaleString'
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error testing timezone',
      error: error.message
    });
  }
};
