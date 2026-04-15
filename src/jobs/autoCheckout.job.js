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
import { executeJobWithTimeout, processBatchRecords } from '../utils/jobHelper.js';
import { defuzzifyMatrixTFN, computeCR } from '../analytics/fahp.js';
import { extentWeightsTFN } from '../analytics/fahp.extent.js';
import { SMART_AC_PAIRWISE_TFN } from '../analytics/config.fahp.js';

const TOLERANCE_MIN = parseInt(process.env.LATE_CHECKOUT_TOLERANCE_MIN || '120', 10);
const DEFAULT_SHIFT_END = process.env.DEFAULT_SHIFT_END || '17:00:00';

export const startAutoCheckoutJob = () => {
  logger.info('Missed checkout flagger scheduled to run every 30 minutes');
  cron.schedule(
    '*/30 * * * *',
    async () => {
      try {
        await executeJobWithTimeout(
          'MissedCheckoutFlagger',
          runMissedCheckoutFlagger,
          3 * 60 * 1000
        ); // 3 min timeout
      } catch (error) {
        logger.error('Missed checkout flagger failed:', error);
      }
    },
    {
      scheduled: true,
      timezone: 'Asia/Jakarta'
    }
  );

  // Nightly Smart Auto Checkout for yesterday (H-1)
  logger.info('Smart Auto Checkout (FAHP+DOW) scheduled to run daily at 23:45');
  cron.schedule(
    '45 23 * * *',
    async () => {
      try {
        await executeJobWithTimeout(
          'SmartAutoCheckout',
          async () => {
            // Get current Jakarta time properly
            const now = new Date();
            const jakartaTimeString = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
            const jakartaTime = new Date(jakartaTimeString);

            // Calculate yesterday (H-1) in Jakarta timezone
            const yesterday = new Date(jakartaTime);
            yesterday.setDate(jakartaTime.getDate() - 1);
            const targetDate = yesterday.toISOString().split('T')[0];

            return await runSmartAutoCheckoutForDate(targetDate);
          },
          10 * 60 * 1000 // 10 min timeout for smart checkout
        );
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

  // Compute DOW in Jakarta timezone
  const base = new Date(`${targetDate}T00:00:00+07:00`);
  const jakartaTimeString = base.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
  const jakartaDate = new Date(jakartaTimeString);
  const dow = jakartaDate.getDay();

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
    const d = new Date(`${h.attendance_date}T00:00:00+07:00`);
    const dTimeString = d.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
    const dJakarta = new Date(dTimeString);
    return dJakarta.getDay() === dow;
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
    const d = new Date(`${h.attendance_date}T00:00:00+07:00`);
    const dTimeString = d.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
    const dJakarta = new Date(dTimeString);
    return h.category_id === categoryId && dJakarta.getDay() === dow;
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
    logger.info(`Smart Auto Checkout started for date: ${targetDate}`);
    const weights = getFahpWeights();
    const fallbackSetting = await Settings.findOne({
      where: { setting_key: 'checkout.fallback_time' }
    });
    const fallbackShiftEnd = fallbackSetting?.setting_value || '17:00:00';

    let smartUsed = 0;
    let fallbackUsed = 0;
    const finalizedAttendances = await Attendance.findAll({
      where: {
        attendance_date: targetDate,
        time_in: { [Op.not]: null },
        time_out: { [Op.not]: null }
      },
      attributes: ['id_attendance']
    });
    let skipped = finalizedAttendances.length;

    // Use batch processing for large datasets
    const queryOptions = {
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
    };

    await processBatchRecords(
      Attendance,
      queryOptions,
      async (attendanceBatch, batchNumber) => {
        logger.info(`Processing batch ${batchNumber} with ${attendanceBatch.length} records`);

        for (const att of attendanceBatch) {
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
            logger.warn(
              `Smart auto checkout failed for attendance ${att.id_attendance}: ${e.message}`
            );
            skipped++;
          }
        }

        return {
          batchSmartUsed: smartUsed,
          batchFallbackUsed: fallbackUsed,
          batchSkipped: skipped
        };
      },
      100 // Batch size: 100 records per query
    );

    logger.info(
      `Smart Auto Checkout for ${targetDate}: Smart=${smartUsed}, Fallback=${fallbackUsed}, Skipped=${skipped}`
    );
    return { targetDate, smartUsed, fallbackUsed, skipped };
  } catch (error) {
    logger.error('runSmartAutoCheckoutForDate failed:', error);
    throw error;
  }
};

const runMissedCheckoutFlagger = async () => {
  try {
    logger.info('Missed Checkout Flagger started');
    // Get current Jakarta time properly
    const now = new Date();
    const jakartaTimeString = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
    const jakartaTime = new Date(jakartaTimeString);
    const todayDate = jakartaTime.toISOString().split('T')[0];

    // Load fallback shift end from settings if available
    const fallbackSetting = await Settings.findOne({
      where: { setting_key: 'checkout.fallback_time' }
    });
    const fallbackShiftEnd = fallbackSetting?.setting_value || DEFAULT_SHIFT_END;

    let totalFlagged = 0;

    // Use batch processing for large datasets
    const queryOptions = {
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
    };

    const result = await processBatchRecords(
      Attendance,
      queryOptions,
      async (attendanceBatch, batchNumber) => {
        logger.info(`Flagging batch ${batchNumber} with ${attendanceBatch.length} records`);
        let batchFlagged = 0;

        for (const attendance of attendanceBatch) {
          try {
            // Determine shift end time in Jakarta timezone
            const shiftEndJakarta = new Date(`${todayDate}T${fallbackShiftEnd}+07:00`);

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
              const finalCheckoutTime = new Date(`${todayDate}T${fallbackShiftEnd}+07:00`);

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
              batchFlagged++;
              totalFlagged++;
            }
          } catch (error) {
            logger.error(
              `Error processing missed checkout for attendance ${attendance.attendance_id}:`,
              error
            );
          }
        }

        return { batchFlagged };
      },
      100 // Batch size: 100 records per query
    );

    logger.info(
      `Missed checkout flagger completed. Total processed: ${result.totalProcessed}, Total flagged: ${totalFlagged}`
    );
    return { total_processed: result.totalProcessed, flagged: totalFlagged };
  } catch (error) {
    logger.error('Missed checkout flagger failed:', error);
    throw error;
  }
};
