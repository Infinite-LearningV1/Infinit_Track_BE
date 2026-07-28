import { Op } from 'sequelize';
import { isValid, parseISO } from 'date-fns';
import axios from 'axios';

import sequelize from '../config/database.js';
import { Booking, Location, BookingStatus, User, Position, Role } from '../models/index.js';
import fuzzyEngine from '../utils/fuzzyAhpEngine.js';
import logger from '../utils/logger.js';
import { getJakartaDateString } from '../utils/geofence.js';
import {
  readWfaRequestConfig,
  resolveActiveWfaRequestReason,
  resolveActiveWfaRejectionReason
} from '../services/wfaSettings.service.js';

const BOOKING_STATUS = Object.freeze({
  approved: { id: 1, label: 'Approved' },
  rejected: { id: 2, label: 'Rejected' },
  pending: { id: 3, label: 'Pending' }
});

const BOOKING_STATUS_BY_ID = Object.freeze(
  Object.entries(BOOKING_STATUS).reduce((acc, [key, value]) => {
    acc[value.id] = { key, label: value.label };
    return acc;
  }, {})
);

const BOOKING_HISTORY_STATUS_FILTERS = Object.freeze({
  all: null,
  approved: BOOKING_STATUS.approved.id,
  rejected: BOOKING_STATUS.rejected.id,
  pending: BOOKING_STATUS.pending.id
});

function getBookingStatusPresentation(booking) {
  const statusFromId = BOOKING_STATUS_BY_ID[Number(booking.status)];
  const fallbackKey = booking.booking_status?.name_status
    ? String(booking.booking_status.name_status).toLowerCase()
    : null;
  const statusKey = statusFromId?.key || fallbackKey;

  return {
    status_key: statusKey,
    status_label: statusFromId?.label || (statusKey ? statusKey.charAt(0).toUpperCase() + statusKey.slice(1) : null)
  };
}

function buildBookingHistorySummary(summaryRows) {
  const summary = {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0
  };

  for (const row of summaryRows) {
    const statusMeta = BOOKING_STATUS_BY_ID[Number(row.status)];
    if (!statusMeta) continue;

    const count = Number(row.count) || 0;
    summary[statusMeta.key] = count;
    summary.total += count;
  }

  return summary;
}

/**
 * Fetches place details from Geoapify and calculates its suitability score.
 * If no data is found, returns a default score.
 * @param {number} latitude - The latitude of the location.
 * @param {number} longitude - The longitude of the location.
 * @returns {Promise<{suitability_score: number, suitability_label: string}>}
 */
async function getSuitabilityScoreForCustomLocation(latitude, longitude) {
  try {
    const geoapifyApiKey = process.env.GEOAPIFY_API_KEY || process.env.GEOAPIFY_KEY;
    if (!process.env.GEOAPIFY_API_KEY && process.env.GEOAPIFY_KEY) {
      logger.warn(
        'Using legacy GEOAPIFY_KEY fallback for booking suitability scoring; migrate to GEOAPIFY_API_KEY.'
      );
    }
    if (!geoapifyApiKey) {
      logger.error('Geoapify API key not found for booking suitability scoring. Set GEOAPIFY_API_KEY.');
      return {
        suitability_score: 50,
        suitability_label: 'Lokasi tidak terdaftar'
      };
    }

    // Panggil Geoapify Places API untuk mencari tempat terdekat dari koordinat
    const apiUrl = 'https://api.geoapify.com/v2/places';
    const params = {
      categories: 'catering,accommodation,office,education,commercial,leisure', // Kategori luas
      filter: `circle:${longitude},${latitude},50`, // Radius 50 meter
      limit: 1, // Ambil 1 hasil teratas
      apiKey: geoapifyApiKey
    };

    const diagnosticParams = { ...params, apiKey: '[REDACTED]' };
    logger.info(
      `[DIAGNOSTIC] Calling Geoapify URL: ${apiUrl} with params: ${JSON.stringify(diagnosticParams)}`
    );

    const response = await axios.get(apiUrl, { params });

    const features = response.data.features;
    if (!features || features.length === 0) {
      logger.warn(`No Geoapify data found for coords: ${latitude},${longitude}`);
      return {
        suitability_score: 50,
        suitability_label: 'Lokasi tidak terdaftar'
      };
    }

    // Ambil data tempat pertama yang paling relevan
    const placeData = features[0];

    // Format data agar sesuai dengan input fuzzyEngine
    const mockPlaceDetails = {
      properties: placeData.properties,
      geometry: {
        type: 'Point',
        coordinates: [longitude, latitude]
      }
    };

    // Hitung skor menggunakan Fuzzy AHP Engine
    const scoreResult = await fuzzyEngine.calculateWfaScore(mockPlaceDetails);

    return {
      suitability_score: scoreResult.score,
      suitability_label: scoreResult.label
    };
  } catch (error) {
    logger.error(`Failed to get suitability score for custom location: ${error.message}`);
    // Jika ada error, kembalikan nilai default
    return {
      suitability_score: 50,
      suitability_label: 'Lokasi tidak terdaftar'
    };
  }
}

// BAGIAN 1: Endpoint Membuat Booking (POST /api/bookings)
export const createBooking = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const userId = req.user.id;
    const {
      schedule_date,
      request_reason_id,
      request_other_reason,
      latitude,
      longitude,
      description,
      notes = '',
      location_id
    } = req.body;
    const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
    const isStrictCalendarDate = (value) => {
      if (typeof value !== 'string' || !isoPattern.test(value)) return false;
      const [year, month, day] = value.split('-').map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      return (
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
      );
    };

    if (!isStrictCalendarDate(schedule_date)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        code: 'INVALID_SCHEDULE_DATE',
        message: 'Tanggal WFA harus menggunakan format YYYY-MM-DD.',
        errors: [{ field: 'schedule_date', code: 'INVALID_SCHEDULE_DATE' }]
      });
    }

    // Build today (Jakarta) string for comparisons
    const todayIso = getJakartaDateString();
    const scheduleDateISO = schedule_date;
    const errors = [];

    // B) Aturan Bisnis
    if (errors.length === 0) {
      // 1) Not in past
      if (scheduleDateISO < todayIso) {
        errors.push({
          field: 'schedule_date',
          code: 'PAST_DATE_NOT_ALLOWED',
          message: 'Tanggal booking tidak boleh di masa lalu.'
        });
      }
      // 2) Not same-day
      if (scheduleDateISO === todayIso) {
        errors.push({
          field: 'schedule_date',
          code: 'SAME_DAY_NOT_ALLOWED',
          message: 'Booking di hari yang sama tidak diperbolehkan.'
        });
      }
    }

    // Early exit for format/value/same/past
    if (errors.length > 0) {
      await transaction.rollback();
      logger.debug(
        `[BOOKING_CREATE] schedule_date_raw='${schedule_date}', normalized='${scheduleDateISO || ''}', errors=${JSON.stringify(errors)}`
      );
      return res.status(400).json({ success: false, message: 'Validasi booking gagal.', errors });
    }

    // No hour-based H-1: next-day (scheduleDateISO > todayIso) is acceptable

    const formattedScheduleDate = scheduleDateISO;
    const { radiusMeters } = await readWfaRequestConfig(transaction);
    const { reason, normalizedOtherReason } = await resolveActiveWfaRequestReason({
      reasonId: request_reason_id,
      otherReasonText: request_other_reason,
      transaction
    });

    // Cek booking conflict pada tanggal yang sama (pending/approved)
    const existingBookingOnDate = await Booking.findOne({
      where: {
        user_id: userId,
        schedule_date: formattedScheduleDate,
        status: { [Op.in]: [1, 3] } // approved (1) atau pending (3)
      },
      transaction
    });

    if (existingBookingOnDate) {
      await transaction.rollback();
      return res.status(409).json({
        success: false,
        code: 'DUPLICATE_BOOKING',
        message: 'Validasi booking gagal.',
        errors: [
          {
            field: 'schedule_date',
            code: 'DUPLICATE_BOOKING',
            message: 'Anda sudah memiliki booking pada tanggal tersebut.'
          }
        ]
      });
    }

    const scoreResult = await getSuitabilityScoreForCustomLocation(latitude, longitude);
    const { suitability_score, suitability_label } = scoreResult;
    logger.info(
      `Calculated suitability score for custom location: ${suitability_score} (${suitability_label}) for user ${userId}`
    );

    // Proses Database: validasi lokasi (by id) atau buat baru dari koordinat (tanpa kebijakan jarak)
    let newLocation;
    if (location_id) {
      const existingLocation = await Location.findByPk(location_id, { transaction });
      if (!existingLocation) {
        await transaction.rollback();
        return res.status(404).json({
          success: false,
          message: 'Validasi booking gagal.',
          errors: [
            {
              field: 'location_id',
              code: 'LOCATION_NOT_FOUND',
              message: 'Lokasi tidak ditemukan atau tidak valid.'
            }
          ]
        });
      }
      newLocation = existingLocation;
    } else {
      newLocation = await Location.create(
        {
          user_id: userId,
          id_attendance_categories: 3, // WFA category
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          radius: radiusMeters,
          description: description || 'WFA Location'
        },
        { transaction }
      );
    }
    // 2. Buat entri baru di tabel bookings
    const newBooking = await Booking.create(
      {
        user_id: userId,
        schedule_date: formattedScheduleDate, // YYYY-MM-DD format
        location_id: newLocation.location_id,
        notes: typeof notes === 'string' ? notes.trim() : '',
        status: 3, // pending
        suitability_score,
        suitability_label,
        request_reason_id: reason.id,
        request_other_reason: normalizedOtherReason,
        radius_snapshot: radiusMeters,
        created_at: new Date()
      },
      { transaction }
    );

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: 'Booking WFA berhasil dibuat.',
      data: {
        booking_id: newBooking.booking_id,
        schedule_date: newBooking.schedule_date,
        status: 'pending',
        request_reason: {
          id: reason.id,
          label: reason.label,
          is_other: Boolean(reason.is_other),
          other_text: normalizedOtherReason
        },
        location: {
          location_id: newLocation.location_id,
          latitude: Number(newLocation.latitude ?? latitude),
          longitude: Number(newLocation.longitude ?? longitude),
          radius: radiusMeters,
          description: newLocation.description ?? description ?? null
        },
        radius_snapshot: radiusMeters,
        suitability_score,
        suitability_label,
        created_at: newBooking.created_at
      }
    });
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
};

// BAGIAN 2: Endpoint Menyetujui Booking (PATCH /api/bookings/{id})
export const updateBookingStatus = async (req, res, next) => {
  const transaction = await sequelize.transaction();

  try {
    const { id } = req.params;
    const { status, rejection_reason_id, rejection_note } = req.body;
    const approvedBy = req.user.id;

    // Validasi: cari booking
    const booking = await Booking.findByPk(id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['full_name', 'email']
        },
        {
          model: Location,
          as: 'location'
        }
      ],
      transaction
    });

    if (!booking) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Booking tidak ditemukan.'
      });
    }

    // Validasi: pastikan schedule_date belum lewat
    const scheduleDate = new Date(booking.schedule_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (scheduleDate < today) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Tidak dapat memproses booking yang sudah lewat tanggalnya.'
      });
    }

    // Validasi: pastikan status valid
    const validStatuses = ['approved', 'rejected'];
    if (!validStatuses.includes(status)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Status harus "approved" atau "rejected".'
      });
    }

    let rejectionDecision = { reason: null, normalizedNote: null };
    if (status === 'rejected') {
      rejectionDecision = await resolveActiveWfaRejectionReason({
        reasonId: rejection_reason_id,
        note: rejection_note,
        transaction
      });
    }

    const decisionPayload =
      status === 'approved'
        ? {
            status: 1,
            rejection_reason_id: null,
            rejection_note: null,
            approved_by: approvedBy,
            processed_at: new Date()
          }
        : {
            status: 2,
            rejection_reason_id: rejectionDecision.reason.id,
            rejection_note: rejectionDecision.normalizedNote,
            approved_by: approvedBy,
            processed_at: new Date()
          };

    // Update record booking
    await booking.update(decisionPayload, { transaction });

    await transaction.commit();

    // Fetch updated booking dengan relasi untuk response
    const updatedBooking = await Booking.findByPk(id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['full_name', 'email']
        },
        {
          model: Location,
          as: 'location'
        },
        {
          model: BookingStatus,
          as: 'booking_status',
          attributes: ['name_status']
        }
      ]
    });

    // Respons Sukses
    res.status(200).json({
      success: true,
      message: `Booking berhasil di-${status}.`,
      data: {
        booking_id: updatedBooking.booking_id,
        user: {
          full_name: updatedBooking.user.full_name,
          email: updatedBooking.user.email
        },
        schedule_date: updatedBooking.schedule_date,
        status: updatedBooking.booking_status.name_status,
        location: {
          latitude: updatedBooking.location.latitude,
          longitude: updatedBooking.location.longitude,
          radius: updatedBooking.location.radius,
          description: updatedBooking.location.description
        },
        rejection_reason:
          status === 'rejected'
            ? {
                id: rejectionDecision.reason.id,
                label: rejectionDecision.reason.label,
                is_other: Boolean(rejectionDecision.reason.is_other),
                note: rejectionDecision.normalizedNote
              }
            : null,
        processed_at: updatedBooking.processed_at
      }
    });
  } catch (error) {
    await transaction.rollback();
    next(error);
  }
};

// Endpoint tambahan: Mendapatkan daftar booking (untuk admin)
export const getAllBookings = async (req, res, next) => {
  try {
    // Dapatkan Parameter Query
    const { status, page = 1, limit = 10, user_id, date_from, date_to } = req.query;
    const positiveIntegerPattern = /^[1-9]\d*$/;
    const statusMap = {
      approved: 1,
      rejected: 2,
      pending: 3
    };
    const hasQueryParam = (key) => Object.prototype.hasOwnProperty.call(req.query, key);

    const pageValue = String(page);
    const limitValue = String(limit);
    if (!positiveIntegerPattern.test(pageValue) || !positiveIntegerPattern.test(limitValue)) {
      return res.status(400).json({
        success: false,
        message: 'Parameter pagination tidak valid. Page dan limit harus bilangan bulat positif.'
      });
    }

    const pageNum = parseInt(pageValue, 10);
    const limitNum = parseInt(limitValue, 10);
    if (limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: 'Parameter pagination tidak valid. Limit maksimum adalah 100.'
      });
    }

    const offset = (pageNum - 1) * limitNum;

    // Buat objek whereClause untuk Sequelize
    const whereClause = {};

    if (hasQueryParam('status')) {
      const statusValue = String(status);
      const mappedStatus = statusMap[statusValue];
      if (!mappedStatus) {
        return res.status(400).json({
          success: false,
          message: 'Status filter tidak valid. Pilihan: approved, rejected, pending.'
        });
      }

      whereClause.status = mappedStatus;
    }

    if (hasQueryParam('user_id')) {
      const userIdValue = String(user_id);
      if (!positiveIntegerPattern.test(userIdValue)) {
        return res.status(400).json({
          success: false,
          message: 'Parameter user_id tidak valid. user_id harus bilangan bulat positif.'
        });
      }

      whereClause.user_id = parseInt(userIdValue, 10);
    }

    const dateFromValue = String(date_from);
    const dateToValue = String(date_to);
    const strictDatePattern = /^\d{4}-\d{2}-\d{2}$/;
    const hasDateFromFilter = hasQueryParam('date_from');
    const hasDateToFilter = hasQueryParam('date_to');
    const scheduleDateFilter = {};
    let parsedDateFrom = null;
    let parsedDateTo = null;

    if (hasDateFromFilter) {
      if (!strictDatePattern.test(dateFromValue)) {
        return res.status(400).json({
          success: false,
          message: 'Parameter date_from tidak valid. Gunakan format YYYY-MM-DD.'
        });
      }

      parsedDateFrom = parseISO(dateFromValue);
      if (!isValid(parsedDateFrom)) {
        return res.status(400).json({
          success: false,
          message: 'Parameter date_from tidak valid. Gunakan tanggal yang valid.'
        });
      }
      scheduleDateFilter[Op.gte] = dateFromValue;
    }

    if (hasDateToFilter) {
      if (!strictDatePattern.test(dateToValue)) {
        return res.status(400).json({
          success: false,
          message: 'Parameter date_to tidak valid. Gunakan format YYYY-MM-DD.'
        });
      }

      parsedDateTo = parseISO(dateToValue);
      if (!isValid(parsedDateTo)) {
        return res.status(400).json({
          success: false,
          message: 'Parameter date_to tidak valid. Gunakan tanggal yang valid.'
        });
      }
      scheduleDateFilter[Op.lte] = dateToValue;
    }

    if (parsedDateFrom && parsedDateTo && parsedDateFrom > parsedDateTo) {
      return res.status(400).json({
        success: false,
        message: 'Parameter date_from tidak boleh lebih lambat dari date_to.'
      });
    }

    if (hasDateFromFilter || hasDateToFilter) {
      whereClause.schedule_date = scheduleDateFilter;
    }

    // Lakukan Query ke Database dengan include yang lengkap
    const bookings = await Booking.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id_users', 'full_name', 'email', 'nip_nim'],
          include: [
            {
              model: Position,
              as: 'position',
              attributes: ['position_name']
            },
            {
              model: Role,
              as: 'role',
              attributes: ['id_roles', 'role_name']
            }
          ]
        },
        {
          model: Location,
          as: 'location',
          attributes: ['location_id', 'latitude', 'longitude', 'radius', 'description']
        },
        {
          model: BookingStatus,
          as: 'booking_status',
          attributes: ['name_status']
        }
      ],
      order: [
        // Urutan kustom untuk status: 3 (pending), 1 (approved), 2 (rejected)
        [sequelize.fn('FIELD', sequelize.col('status'), 3, 1, 2)],
        // Urutan sekunder: data terbaru di atas dalam setiap grup status
        ['created_at', 'DESC']
      ],
      limit: limitNum,
      offset,
      distinct: true // Important for correct count with includes
    }); // Transform data dengan struktur location yang grouped
    const transformedBookings = bookings.rows.map((booking) => ({
      booking_id: booking.booking_id,
      user_id: booking.user.id_users,
      user_full_name: booking.user.full_name,
      user_role_name: booking.user.role ? booking.user.role.role_name : null,
      user_email: booking.user.email,
      user_nip_nim: booking.user.nip_nim,
      user_position_name: booking.user.position ? booking.user.position.position_name : null,
      schedule_date: booking.schedule_date,
      status: booking.booking_status.name_status,
      location: {
        location_id: booking.location.location_id,
        latitude: parseFloat(booking.location.latitude),
        longitude: parseFloat(booking.location.longitude),
        radius: parseFloat(booking.location.radius),
        description: booking.location.description
      },
      notes: booking.notes,
      suitability_score: parseFloat(booking.suitability_score) || null,
      suitability_label: booking.suitability_label,
      created_at: booking.created_at,
      processed_at: booking.processed_at,
      approved_by: booking.approved_by
    }));

    // Response dengan struktur data yang flattened
    res.status(200).json({
      success: true,
      data: {
        bookings: transformedBookings,
        pagination: {
          current_page: pageNum,
          total_pages: Math.ceil(bookings.count / limitNum),
          total_items: bookings.count,
          items_per_page: limitNum
        }
      },
      message: 'Daftar booking berhasil diambil'
    });
  } catch (error) {
    next(error);
  }
};

// Endpoint tambahan: Mendapatkan booking user sendiri
export const getMyBookings = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    const bookings = await Booking.findAndCountAll({
      where: { user_id: userId },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id_users', 'full_name', 'email', 'nip_nim'],
          include: [
            {
              model: Position,
              as: 'position',
              attributes: ['position_name']
            },
            {
              model: Role,
              as: 'role',
              attributes: ['id_roles', 'role_name']
            }
          ]
        },
        {
          model: Location,
          as: 'location'
        },
        {
          model: BookingStatus,
          as: 'booking_status',
          attributes: ['name_status']
        }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    }); // Transform data untuk konsistensi dengan getAllBookings
    const transformedBookings = bookings.rows.map((booking) => ({
      booking_id: booking.booking_id,
      user_id: booking.user.id_users,
      user_full_name: booking.user.full_name,
      user_email: booking.user.email,
      user_nip_nim: booking.user.nip_nim,
      user_position_name: booking.user.position ? booking.user.position.position_name : null,
      user_role_name: booking.user.role ? booking.user.role.role_name : null,
      schedule_date: booking.schedule_date,
      status: booking.booking_status.name_status,
      location: {
        location_id: booking.location.location_id,
        latitude: parseFloat(booking.location.latitude),
        longitude: parseFloat(booking.location.longitude),
        radius: parseFloat(booking.location.radius),
        description: booking.location.description
      },
      notes: booking.notes,
      suitability_score: parseFloat(booking.suitability_score) || null,
      suitability_label: booking.suitability_label,
      created_at: booking.created_at,
      processed_at: booking.processed_at,
      approved_by: booking.approved_by
    }));

    res.status(200).json({
      success: true,
      data: {
        bookings: transformedBookings,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(bookings.count / limit),
          total_items: bookings.count,
          items_per_page: parseInt(limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// BAGIAN 4: Endpoint Menghapus Booking (DELETE /api/bookings/{id})
export const deleteBooking = async (req, res, next) => {
  const t = await sequelize.transaction();

  try {
    // Langkah 1: Dapatkan ID dari Parameter URL
    const { id } = req.params;

    // Langkah 2: Cari Record Booking
    const bookingRecord = await Booking.findByPk(id, { transaction: t });

    // Langkah 3: Handle Jika Data Tidak Ditemukan
    if (!bookingRecord) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: 'Data booking tidak ditemukan.'
      });
    }

    // Langkah 4: Hapus Record Booking
    await bookingRecord.destroy({ transaction: t });

    // Langkah 5: Commit Transaksi
    await t.commit();

    // Langkah 6: Kirim Respons Sukses
    res.status(200).json({
      success: true,
      message: 'Data booking berhasil dihapus.'
    });
  } catch (error) {
    await t.rollback();
    next(error);
  }
};

// NEW ENDPOINT: Get booking history for authenticated user
export const getBookingHistory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { status = 'all', page = 1, limit = 10, sort_by = 'created_at', sort_order = 'DESC' } = req.query;
    const selectedStatus = String(status).toLowerCase();

    // Validate pagination parameters
    const positiveIntegerPattern = /^[1-9]\d*$/;
    const pageValue = String(page);
    const limitValue = String(limit);
    if (!positiveIntegerPattern.test(pageValue) || !positiveIntegerPattern.test(limitValue)) {
      return res.status(400).json({
        success: false,
        message: 'Parameter pagination tidak valid. Page >= 1, limit antara 1-100.'
      });
    }

    const pageNum = parseInt(pageValue, 10);
    const limitNum = parseInt(limitValue, 10);
    if (limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: 'Parameter pagination tidak valid. Page >= 1, limit antara 1-100.'
      });
    }

    const offset = (pageNum - 1) * limitNum;

    if (!Object.prototype.hasOwnProperty.call(BOOKING_HISTORY_STATUS_FILTERS, selectedStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Status filter tidak valid. Pilihan: all, approved, rejected, pending.'
      });
    }

    // Build where clause with status filter. status=all behaves like no status filter.
    const whereClause = { user_id: userId };
    const selectedStatusId = BOOKING_HISTORY_STATUS_FILTERS[selectedStatus];
    if (selectedStatusId) {
      whereClause.status = selectedStatusId;
    }

    // Validate sorting parameters
    const validSortFields = ['created_at', 'schedule_date', 'processed_at', 'status'];
    const validSortOrders = ['ASC', 'DESC'];

    if (!validSortFields.includes(sort_by)) {
      return res.status(400).json({
        success: false,
        message: `Sort field tidak valid. Pilihan: ${validSortFields.join(', ')}.`
      });
    }

    if (!validSortOrders.includes(sort_order.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Sort order harus ASC atau DESC.'
      });
    }

    // Build order clause
    let orderClause;
    if (sort_by === 'status') {
      // Custom status ordering: pending (3), approved (1), rejected (2)
      orderClause = [
        [sequelize.fn('FIELD', sequelize.col('status'), 3, 1, 2), sort_order.toUpperCase()],
        ['created_at', 'DESC'] // Secondary sort
      ];
    } else {
      orderClause = [[sort_by, sort_order.toUpperCase()]];
    }

    const summaryRows = await Booking.findAll({
      attributes: ['status', [sequelize.fn('COUNT', sequelize.col('booking_id')), 'count']],
      where: {
        user_id: userId,
        status: { [Op.in]: Object.values(BOOKING_STATUS).map(({ id }) => id) }
      },
      group: ['status'],
      raw: true
    });
    const summary = buildBookingHistorySummary(summaryRows);

    // Query bookings with full relations
    const bookings = await Booking.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id_users', 'full_name', 'email', 'nip_nim'],
          include: [
            {
              model: Position,
              as: 'position',
              attributes: ['position_name']
            },
            {
              model: Role,
              as: 'role',
              attributes: ['id_roles', 'role_name']
            }
          ]
        },
        {
          model: Location,
          as: 'location',
          attributes: ['location_id', 'latitude', 'longitude', 'radius', 'description']
        },
        {
          model: BookingStatus,
          as: 'booking_status',
          attributes: ['name_status']
        }
      ],
      order: orderClause,
      limit: limitNum,
      offset: offset,
      distinct: true
    });

    // Transform data with consistent structure
    const transformedBookings = bookings.rows.map((booking) => {
      const statusPresentation = getBookingStatusPresentation(booking);

      return {
        booking_id: booking.booking_id,
        user_id: booking.user.id_users,
        user_full_name: booking.user.full_name,
        user_email: booking.user.email,
        user_nip_nim: booking.user.nip_nim,
        user_position_name: booking.user.position ? booking.user.position.position_name : null,
        user_role_name: booking.user.role ? booking.user.role.role_name : null,
        schedule_date: booking.schedule_date,
        status: booking.booking_status.name_status,
        status_key: statusPresentation.status_key,
        status_label: statusPresentation.status_label,
        location: {
          location_id: booking.location.location_id,
          latitude: parseFloat(booking.location.latitude),
          longitude: parseFloat(booking.location.longitude),
          radius: parseFloat(booking.location.radius),
          description: booking.location.description
        },
        notes: booking.notes,
        suitability_score: parseFloat(booking.suitability_score) || null,
        suitability_label: booking.suitability_label,
        created_at: booking.created_at,
        processed_at: booking.processed_at,
        approved_by: booking.approved_by
      };
    });

    // Calculate pagination info
    const totalPages = Math.ceil(bookings.count / limitNum);

    // Log for monitoring
    logger.info(
      `Booking history retrieved for user ${userId}: ${bookings.count} total, page ${pageNum}/${totalPages}`
    );

    // Response with comprehensive data and metadata
    res.status(200).json({
      success: true,
      data: {
        summary,
        bookings: transformedBookings,
        pagination: {
          current_page: pageNum,
          total_pages: totalPages,
          total_items: bookings.count,
          items_per_page: limitNum,
          has_next_page: pageNum < totalPages,
          has_previous_page: pageNum > 1
        },
        filters: {
          status: selectedStatus,
          sort_by: sort_by,
          sort_order: sort_order.toUpperCase()
        }
      },
      message: `Riwayat booking berhasil diambil. Ditemukan ${bookings.count} booking.`
    });
  } catch (error) {
    logger.error(`Error getting booking history for user ${req.user?.id}:`, error);
    next(error);
  }
};
