console.log('AutoCheckout job: Starting file execution...');

import cron from 'node-cron';
import { Op } from 'sequelize';

import {
  Attendance,
  Settings,
  User,
  LocationEvent,
  AttendanceCategory,
  Booking
} from '../models/index.js';
import { calculateWorkHour, formatTimeOnly } from '../utils/workHourFormatter.js';
import { toJakartaTime } from '../utils/geofence.js';
import fuzzyAhpEngine from '../utils/fuzzyAhpEngine.js';
import logger from '../utils/logger.js';
import { defuzzifyMatrixTFN, computeCR } from '../analytics/fahp.js';
import { extentWeightsTFN } from '../analytics/fahp.extent.js';
import { SMART_AC_PAIRWISE_TFN } from '../analytics/config.fahp.js';

const TOLERANCE_MIN = parseInt(process.env.LATE_CHECKOUT_TOLERANCE_MIN || '120', 10);
const DEFAULT_SHIFT_END = process.env.DEFAULT_SHIFT_END || '17:00:00';

export const startAutoCheckoutJob = () => {
  logger.info('Missed checkout flagger scheduled to run every 30 minutes');
  cron.schedule('*/30 * * * *', runMissedCheckoutFlagger, {
    scheduled: true,
    timezone: 'Asia/Jakarta'
  });

  // Nightly Smart Auto Checkout for yesterday (H-1)
  logger.info('Smart Auto Checkout (FAHP+DOW) scheduled to run daily at 23:45');
  cron.schedule(
    '45 23 * * *',
    async () => {
      try {
        const now = new Date();
        const jakartaOffsetMs = 7 * 60 * 60000;
        const jkt = new Date(now.getTime() + jakartaOffsetMs);
        const y = new Date(jkt);
        y.setDate(jkt.getDate() - 1);
        const targetDate = y.toISOString().split('T')[0];
        await runSmartAutoCheckoutForDate(targetDate);
      } catch (e) {
        logger.error('Smart Auto Checkout nightly failed:', e);
      }
    },
    {
      scheduled: true,
      timezone: 'Asia/Jakarta'
    }
  );
};

export const triggerAutoCheckout = async () => {
  logger.info('Manual trigger: Missed checkout flagger');
  const result = await runMissedCheckoutFlagger();
  return {
    success: true,
    message: 'Missed checkout flagger completed',
    timestamp: new Date().toISOString(),
    details: result
  };
};

// ================= SMART AUTO CHECKOUT (FAHP + DOW) =================

function getFahpWeights() {
  const weights = extentWeightsTFN(SMART_AC_PAIRWISE_TFN);
  // Optional CR logging for diagnostics
  try {
    const crisp = defuzzifyMatrixTFN(SMART_AC_PAIRWISE_TFN);
    const { CR } = computeCR(crisp);
    logger.info(`Smart Auto Checkout FAHP CR=${CR.toFixed(3)}`);
  } catch (e) {
    logger.debug(`CR computation failed: ${e?.message || e}`);
  }
  return weights; // [w_hist, w_checkin, w_context, w_transition]
}

function median(numbers) {
  if (!numbers || numbers.length === 0) return null;
  const arr = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function minutesSinceMidnightWIB(d) {
  const j = toJakartaTime(d);
  return j.getHours() * 60 + j.getMinutes();
}

// clampCheckout moved into fuzzyAhpEngine.weightedPrediction helper

// Return null if candidate violates constraints instead of clamping
function sanitizeCandidate(targetDate, candidate, timeIn, endBoundaryStr) {
  if (!candidate) return null;
  const end = new Date(`${targetDate}T${endBoundaryStr || '18:00:00'}+07:00`);
  const tIn = new Date(timeIn);
  if (candidate.getTime() < tIn.getTime()) return null;
  if (candidate.getTime() > end.getTime()) return null;
  const candDateStr = candidate.toISOString().split('T')[0];
  if (candDateStr !== targetDate) return null;
  return candidate;
}

async function buildCandidates(att, targetDate, fallbackEndStr) {
  const candidates = {};
  const userId = att.user_id;
  const categoryId = att.category_id;
  const timeIn = new Date(att.time_in);

  // Compute DOW in Jakarta (UTC+7)
  const base = new Date(`${targetDate}T00:00:00.000Z`);
  const jakartaOffsetMs = 7 * 60 * 60000;
  const jkt = new Date(base.getTime() + jakartaOffsetMs);
  const dow = jkt.getDay();

  // History window H-30..H-1
  const from = new Date(base);
  from.setDate(from.getDate() - 30);
  const history = await Attendance.findAll({
    where: {
      user_id: userId,
      category_id: categoryId,
      attendance_date: { [Op.between]: [from.toISOString().split('T')[0], targetDate] },
      time_in: { [Op.not]: null },
      time_out: { [Op.not]: null }
    },
    attributes: ['time_in', 'time_out', 'attendance_date']
  });

  const sameDow = history.filter((h) => {
    const d = new Date(`${h.attendance_date}T00:00:00.000Z`);
    const dj = new Date(d.getTime() + jakartaOffsetMs);
    return dj.getDay() === dow;
  });
  const pool = sameDow.length >= 5 ? sameDow : history;
  if (pool.length >= 5) {
    const mins = pool
      .map((h) => new Date(h.time_out))
      .map((d) => minutesSinceMidnightWIB(d))
      .filter((m) => m >= 240 && m <= 840);
    const med = median(mins);
    if (med != null) {
      const hh = String(Math.floor(med / 60)).padStart(2, '0');
      const mm = String(Math.floor(med % 60)).padStart(2, '0');
      const checkout = new Date(`${targetDate}T${hh}:${mm}:00+07:00`);
      candidates.HIST = sanitizeCandidate(targetDate, checkout, timeIn, fallbackEndStr);
    }
  }

  // CHECKIN: time_in + 8h
  const checkinCandidate = new Date(timeIn.getTime() + 8 * 60 * 60 * 1000);
  candidates.CHECKIN = sanitizeCandidate(targetDate, checkinCandidate, timeIn, fallbackEndStr);

  // CONTEXT: org median per (category, DOW) -> category -> org-wide
  const orgSessions = await Attendance.findAll({
    where: {
      time_in: { [Op.not]: null },
      time_out: { [Op.not]: null }
    },
    attributes: ['time_out', 'attendance_date', 'category_id']
  });
  function pickContext(filterFn) {
    const arr = orgSessions
      .filter(filterFn)
      .map((h) => new Date(h.time_out))
      .map((d) => minutesSinceMidnightWIB(d))
      .filter((m) => m >= 240 && m <= 840);
    const med = median(arr);
    if (med == null) return null;
    const hh = String(Math.floor(med / 60)).padStart(2, '0');
    const mm = String(Math.floor(med % 60)).padStart(2, '0');
    const checkout = new Date(`${targetDate}T${hh}:${mm}:00+07:00`);
    return sanitizeCandidate(targetDate, checkout, timeIn, fallbackEndStr);
  }
  const ctxCatDow = pickContext((h) => {
    const d = new Date(`${h.attendance_date}T00:00:00.000Z`);
    const dj = new Date(d.getTime() + jakartaOffsetMs);
    return h.category_id === categoryId && dj.getDay() === dow;
  });
  candidates.CONTEXT =
    ctxCatDow || pickContext((h) => h.category_id === categoryId) || pickContext(() => true);

  // TRANSITION: last EXIT event after time_in on targetDate, valid geofence
  try {
    // Determine expected location by category
    const categoryName = (att.attendance_category?.category_name || '').toLowerCase();
    let expectedLocationId = null;
    if (categoryName.includes('wfo') || categoryName.includes('work from office')) {
      expectedLocationId = att.location_id || null;
    } else if (categoryName.includes('wfa') || categoryName.includes('work from anywhere')) {
      // Use booking location if approved and same date
      const b = att.booking;
      if (
        b &&
        b.location_id &&
        String(b.schedule_date) === String(targetDate) &&
        Number(b.status) === 1
      ) {
        expectedLocationId = b.location_id;
      }
    }

    if (expectedLocationId != null) {
      const dayStart = new Date(`${targetDate}T00:00:00.000Z`);
      const dayEnd = new Date(`${targetDate}T23:59:59.999Z`);
      const lastExit = await LocationEvent.findOne({
        where: {
          user_id: userId,
          event_type: 'EXIT',
          location_id: expectedLocationId,
          event_timestamp: {
            [Op.gte]: new Date(Math.max(timeIn.getTime(), dayStart.getTime())),
            [Op.lte]: dayEnd
          }
        },
        order: [['event_timestamp', 'DESC']]
      });
      if (lastExit) {
        const evt = new Date(lastExit.event_timestamp);
        const sanitized = sanitizeCandidate(targetDate, evt, timeIn, fallbackEndStr);
        if (sanitized) {
          candidates.TRANSITION = sanitized;
        }
      }
    }
  } catch (e) {
    // best-effort; ignore transition if any error
  }

  return candidates;
}

// Use engine's weighted prediction
const weightedPrediction = fuzzyAhpEngine.weightedPrediction;

export const runSmartAutoCheckoutForDate = async (targetDate) => {
  try {
    const weights = getFahpWeights();
    const fallbackSetting = await Settings.findOne({
      where: { setting_key: 'checkout.fallback_time' }
    });
    const fallbackShiftEnd = fallbackSetting?.setting_value || '17:00:00';

    const toProcess = await Attendance.findAll({
      where: {
        attendance_date: targetDate,
        time_in: { [Op.not]: null },
        time_out: null
      },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id_users']
        },
        {
          model: AttendanceCategory,
          as: 'attendance_category',
          attributes: ['id_attendance_categories', 'category_name']
        },
        {
          model: Booking,
          as: 'booking',
          attributes: ['booking_id', 'location_id', 'status', 'schedule_date']
        }
      ]
    });

    let smartUsed = 0;
    let fallbackUsed = 0;
    let skipped = 0;

    for (const att of toProcess) {
      try {
        if (att.time_out) {
          skipped++;
          continue;
        }
        const timeIn = new Date(att.time_in);
        const candidates = await buildCandidates(att, targetDate, fallbackShiftEnd);
        const insufficientEvidence = !candidates.HIST && !candidates.TRANSITION;
        const predicted = insufficientEvidence
          ? null
          : weightedPrediction(candidates, weights, targetDate, timeIn, fallbackShiftEnd);

        let finalCheckout = predicted;
        let noteKind = 'smart';
        const availableBasis = Object.keys(candidates)
          .filter((k) => candidates[k])
          .join(',');
        if (!finalCheckout) {
          // Fallback: use fallbackShiftEnd
          finalCheckout = new Date(`${targetDate}T${fallbackShiftEnd}+07:00`);
          noteKind = 'fallback';
        }

        // Debug trace per attendance (helps diagnose 00:00 issues)
        try {
          const inStr = formatTimeOnly(timeIn);
          const predStrDbg = predicted ? formatTimeOnly(predicted) : '-';
          const usedStrDbg = formatTimeOnly(finalCheckout);
          logger.info(
            `SmartAC#${att.id_attendance} date=${targetDate} in=${inStr} pred=${predStrDbg} used=${usedStrDbg} basis=${availableBasis || '-'} mode=${noteKind}`
          );
        } catch (e) {
          // ignore logging failure
        }

        // Ensure final checkout is never earlier than time_in to avoid negative duration
        if (finalCheckout.getTime() < timeIn.getTime()) {
          finalCheckout = new Date(timeIn);
        }

        const workHour = calculateWorkHour(timeIn, finalCheckout);
        const predStr = predicted ? formatTimeOnly(predicted) : null;
        const usedStr = formatTimeOnly(finalCheckout);
        const predDurHours = Math.max(
          0,
          (finalCheckout.getTime() - timeIn.getTime()) / (1000 * 60 * 60)
        );
        const predDurStr = formatTimeOnly(
          new Date(timeIn.getTime() + Math.round(predDurHours * 60) * 60 * 1000)
        );
        const note =
          noteKind === 'smart'
            ? `[Smart AC] pred=${predStr}, used=${usedStr}, basis=${availableBasis}, dur=${predDurStr}`
            : `[Fallback AC] used=${usedStr}, reason=no HIST & TRANSITION, dur=${predDurStr}`;
        const newNotes = att.notes ? `${att.notes}\n${note}` : note;
        await att.update({
          time_out: finalCheckout,
          work_hour: workHour,
          notes: newNotes,
          updated_at: new Date()
        });
        if (noteKind === 'smart') smartUsed++;
        else fallbackUsed++;
      } catch (e) {
        logger.warn(`Smart auto checkout failed for attendance ${att.id_attendance}: ${e.message}`);
      }
    }

    logger.info(
      `Smart Auto Checkout run for ${targetDate}: processed=${toProcess.length}, smart_used=${smartUsed}, fallback_used=${fallbackUsed}, skipped=${skipped}`
    );
  } catch (error) {
    logger.error('runSmartAutoCheckoutForDate failed:', error);
  }
};

const runMissedCheckoutFlagger = async () => {
  try {
    const now = new Date();
    const jakartaOffset = 7 * 60;
    const jakartaTime = new Date(now.getTime() + jakartaOffset * 60000);
    const todayDate = jakartaTime.toISOString().split('T')[0];

    // Find attendances without checkout for today
    const incompleteAttendances = await Attendance.findAll({
      where: {
        attendance_date: todayDate,
        time_out: null
      },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id_users', 'full_name']
        }
      ]
    });

    if (incompleteAttendances.length === 0) {
      logger.info('No open attendances to flag');
      return { total_processed: 0, flagged: 0 };
    }

    let flagged = 0;

    // Load fallback shift end from settings if available
    const fallbackSetting = await Settings.findOne({
      where: { setting_key: 'checkout.fallback_time' }
    });
    const fallbackShiftEnd = fallbackSetting?.setting_value || DEFAULT_SHIFT_END;

    for (const attendance of incompleteAttendances) {
      try {
        // Determine shift end time (use fallback; extend here if per-user schedules are added)
        const [hh, mm, ss] = fallbackShiftEnd.split(':').map(Number);
        const shiftEnd = new Date(`${todayDate}T00:00:00.000Z`);
        shiftEnd.setUTCHours(hh, mm, ss || 0, 0);
        const shiftEndJakarta = new Date(shiftEnd.getTime() + jakartaOffset * 60000);

        const toleranceMs = TOLERANCE_MIN * 60 * 1000;
        const deadline = new Date(shiftEndJakarta.getTime() + toleranceMs);

        if (jakartaTime >= deadline) {
          // Enrichment: fetch last location event (best-effort)
          let lastLocNote = '';
          try {
            const lastEvent = await LocationEvent.findOne({
              where: { user_id: attendance.user_id },
              order: [['event_timestamp', 'DESC']],
              attributes: ['event_timestamp', 'location_id', 'event_type']
            });
            if (lastEvent) {
              const ts = new Date(lastEvent.event_timestamp).toISOString();
              lastLocNote = ` | last_location_event=${lastEvent.event_type}@${lastEvent.location_id} ${ts}`;
            }
          } catch (e) {
            logger.debug(
              `LocationEvent enrichment failed for user ${attendance.user_id}: ${e.message}`
            );
          }

          // Determine final checkout time (fallbackShiftEnd at target date)
          const [checkoutH, checkoutM, checkoutS] = fallbackShiftEnd.split(':').map(Number);
          const checkoutBase = new Date(`${todayDate}T00:00:00.000Z`);
          checkoutBase.setUTCHours(checkoutH, checkoutM, checkoutS || 0, 0);
          const finalCheckoutTime = new Date(checkoutBase.getTime() + jakartaOffset * 60000);

          // Compute work_hour
          const timeIn = new Date(attendance.time_in);
          const workHour = calculateWorkHour(timeIn, finalCheckoutTime);

          const note = `Auto checkout by system after tolerance.${lastLocNote}`;
          const newNotes = attendance.notes ? `${attendance.notes}\n${note}` : note;
          await attendance.update({
            time_out: finalCheckoutTime,
            work_hour: workHour,
            notes: newNotes,
            updated_at: new Date()
          });
          flagged++;
        }
      } catch (e) {
        logger.warn(`Failed to process attendance ${attendance.id_attendance}: ${e.message}`);
      }
    }

    logger.info(
      `Missed checkout flagger completed. Flagged: ${flagged}/${incompleteAttendances.length}`
    );
    return { total_processed: incompleteAttendances.length, flagged };
  } catch (error) {
    logger.error('Missed checkout flagger failed:', error);
    throw error;
  }
};
