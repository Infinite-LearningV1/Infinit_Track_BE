#!/usr/bin/env node

import { fileURLToPath } from 'url';

import Holidays from 'date-holidays';

import {
  APPLY_ACK_FLAG,
  FIXED_OUTPUT_PATH
} from './research-attendance-config.js';

export function parseArgs(argv = []) {
  const apply = argv.includes('--apply');
  const acknowledged = argv.includes(APPLY_ACK_FLAG);

  return {
    apply,
    acknowledged,
    dryRun: !apply,
    outputPath: FIXED_OUTPUT_PATH
  };
}

export function createSeededNumberStream(seed) {
  let state = 0;

  for (const char of String(seed)) {
    state = (state * 31 + char.charCodeAt(0)) >>> 0;
  }

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const ATTENDANCE_CATEGORY_IDS = Object.freeze({ WFO: 1, WFH: 2, WFA: 3 });
const ATTENDANCE_STATUS_IDS = Object.freeze({ ONTIME: 1, LATE: 2, ALPHA: 3, EARLY: 4 });
const BOOKING_STATUS_IDS = Object.freeze({ APPROVED: 1, REJECTED: 2, PENDING: 3 });
const DEFAULT_STATUS_TARGET = Object.freeze({ ontime: 100, late: 0, alpha: 0, early: 0 });
const DEFAULT_MODE_TARGET = Object.freeze({ wfo: 100, wfh: 0, wfa: 0 });
const DEFAULT_GEOFENCE_TARGET = Object.freeze({ full: 100, partial: 0, missing: 0 });
const IMMUTABLE_MONTHS = new Set(['2025-07', '2025-08', '2025-09']);

function toMonthKey(dateString) {
  return dateString.slice(0, 7);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function buildTimeStamp(dateString, hour, minute) {
  return `${dateString} ${pad2(hour)}:${pad2(minute)}:00`;
}

export function buildWorkingDates({ start, end, blackoutMonths, blockedDate, holidays }) {
  const results = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  while (cursor <= endDate) {
    const iso = cursor.toISOString().slice(0, 10);
    const monthKey = iso.slice(0, 7);
    const day = cursor.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    const isBlackout = blackoutMonths.includes(monthKey);
    const isBlocked = iso === blockedDate;
    const holiday = holidays.isHoliday(new Date(`${iso}T12:00:00+07:00`));

    if (!isWeekend && !isBlackout && !isBlocked && !holiday) {
      results.push(iso);
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return results;
}

function buildStableSlots(baselineUsers, workingDates) {
  return workingDates.flatMap((attendanceDate) =>
    baselineUsers
      .slice()
      .sort((a, b) => a.userId - b.userId)
      .map((user) => ({ userId: user.userId, attendanceDate }))
  );
}

function chooseStatusForSlot(statusTarget, nextRandom) {
  const roll = nextRandom() * 100;
  if (roll < statusTarget.ontime) return ATTENDANCE_STATUS_IDS.ONTIME;
  if (roll < statusTarget.ontime + statusTarget.late) return ATTENDANCE_STATUS_IDS.LATE;
  if (roll < statusTarget.ontime + statusTarget.late + statusTarget.alpha) return ATTENDANCE_STATUS_IDS.ALPHA;
  return ATTENDANCE_STATUS_IDS.EARLY;
}

function chooseModeForSlot(modeTarget, nextRandom) {
  const roll = nextRandom() * 100;
  if (roll < modeTarget.wfo) return ATTENDANCE_CATEGORY_IDS.WFO;
  if (roll < modeTarget.wfo + modeTarget.wfh) return ATTENDANCE_CATEGORY_IDS.WFH;
  return ATTENDANCE_CATEGORY_IDS.WFA;
}

function buildAttendanceRow({ userId, attendanceDate, statusId, categoryId, note }) {
  if (statusId === ATTENDANCE_STATUS_IDS.ALPHA) {
    return {
      user_id: userId,
      attendance_date: attendanceDate,
      category_id: categoryId,
      status_id: statusId,
      booking_id: null,
      location_id: null,
      time_in: buildTimeStamp(attendanceDate, 8, 0),
      time_out: null,
      work_hour: 0,
      notes: note
    };
  }

  const timeInHour = statusId === ATTENDANCE_STATUS_IDS.LATE ? 9 : 8;
  const timeInMinute = statusId === ATTENDANCE_STATUS_IDS.EARLY ? 45 : 0;
  return {
    user_id: userId,
    attendance_date: attendanceDate,
    category_id: categoryId,
    status_id: statusId,
    booking_id: null,
    location_id: null,
    time_in: buildTimeStamp(attendanceDate, timeInHour, timeInMinute),
    time_out: buildTimeStamp(attendanceDate, 17, 0),
    work_hour: 8,
    notes: note
  };
}

export function buildResearchAttendancePlan({
  config,
  baselineUsers,
  existingAttendanceRows,
  existingBookingRows,
  existingLocationEvents,
  expectedLocationsByUser,
  holidays = new Holidays('ID')
}) {
  void existingLocationEvents;

  const nextRandom = createSeededNumberStream(config.seed);
  const workingDates = buildWorkingDates({
    start: config.dateRange.start,
    end: config.dateRange.end,
    blackoutMonths: config.blackoutMonths,
    blockedDate: config.blockedDate,
    holidays
  });
  const existingKeys = new Set(
    existingAttendanceRows.map((row) => `${row.user_id}:${row.attendance_date}`)
  );
  const plannedAttendanceRows = [];
  const plannedBookingRows = [];
  const plannedLocationEventRows = [];
  const needsVerification = [];
  const potentialConflicts = [];
  const stableSlots = buildStableSlots(baselineUsers, workingDates);

  for (const slot of stableSlots) {
    const slotKey = `${slot.userId}:${slot.attendanceDate}`;
    if (existingKeys.has(slotKey)) {
      continue;
    }

    const monthKey = toMonthKey(slot.attendanceDate);
    const statusTarget = config.monthlyStatusTargets?.[monthKey] || DEFAULT_STATUS_TARGET;
    const modeTarget = config.monthlyModeTargets?.[monthKey] || DEFAULT_MODE_TARGET;
    const geofenceTarget = config.monthlyGeofenceTargets?.[monthKey] || DEFAULT_GEOFENCE_TARGET;
    const statusId = chooseStatusForSlot(statusTarget, nextRandom);
    const categoryId = chooseModeForSlot(modeTarget, nextRandom);
    const note = config.notes[Math.floor(nextRandom() * config.notes.length)];
    const attendanceRow = buildAttendanceRow({
      userId: slot.userId,
      attendanceDate: slot.attendanceDate,
      statusId,
      categoryId,
      note
    });

    const expectedLocations = expectedLocationsByUser[slot.userId] || {};
    if (categoryId === ATTENDANCE_CATEGORY_IDS.WFO) {
      attendanceRow.location_id = expectedLocations.wfoLocationId || null;
    }
    if (categoryId === ATTENDANCE_CATEGORY_IDS.WFH) {
      attendanceRow.location_id = expectedLocations.wfhLocationId || null;
    }
    if (categoryId === ATTENDANCE_CATEGORY_IDS.WFA) {
      const existingBooking = existingBookingRows.find(
        (booking) =>
          booking.user_id === slot.userId &&
          booking.schedule_date === slot.attendanceDate &&
          booking.status === BOOKING_STATUS_IDS.APPROVED
      );
      const fallbackWfaLocationId = expectedLocations.fallbackWfaLocationId || null;
      if (existingBooking) {
        attendanceRow.booking_id = existingBooking.booking_id;
        attendanceRow.location_id = existingBooking.location_id;
      } else if (fallbackWfaLocationId) {
        attendanceRow.location_id = fallbackWfaLocationId;
        plannedBookingRows.push({
          user_id: slot.userId,
          schedule_date: slot.attendanceDate,
          location_id: fallbackWfaLocationId,
          status: BOOKING_STATUS_IDS.APPROVED,
          notes: 'Kehadiran WFA tercatat sesuai lokasi yang disetujui.'
        });
      } else {
        needsVerification.push({
          type: 'missing_wfa_location',
          userId: slot.userId,
          attendanceDate: slot.attendanceDate
        });
      }
    }

    if (statusId !== ATTENDANCE_STATUS_IDS.ALPHA) {
      const evidenceRoll = nextRandom() * 100;
      if (evidenceRoll < geofenceTarget.full && attendanceRow.location_id) {
        plannedLocationEventRows.push(
          { user_id: slot.userId, location_id: attendanceRow.location_id, event_type: 'ENTER', event_date: slot.attendanceDate },
          { user_id: slot.userId, location_id: attendanceRow.location_id, event_type: 'EXIT', event_date: slot.attendanceDate }
        );
      } else if (evidenceRoll < geofenceTarget.full + geofenceTarget.partial && attendanceRow.location_id) {
        plannedLocationEventRows.push({
          user_id: slot.userId,
          location_id: attendanceRow.location_id,
          event_type: 'ENTER',
          event_date: slot.attendanceDate
        });
      }
    }

    plannedAttendanceRows.push(attendanceRow);
  }

  return {
    population: {
      source: 'existing July 2025 attendance baseline',
      count: baselineUsers.length
    },
    calendar: {
      workingDates
    },
    existingSkipped: stableSlots.length - plannedAttendanceRows.length,
    plannedAttendanceRows,
    plannedBookingRows,
    plannedLocationEventRows,
    monthlySummaries: Object.fromEntries(
      Array.from(
        new Set([
          ...Object.keys(config.monthlyStatusTargets || {}),
          ...workingDates.map((date) => toMonthKey(date))
        ])
      ).map((monthKey) => [
        monthKey,
        { immutableMonth: IMMUTABLE_MONTHS.has(monthKey) }
      ])
    ),
    potentialConflicts,
    needsVerification
  };
}

export function isDirectRun(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl);
}

if (isDirectRun(import.meta.url)) {
  throw new Error('INF-181 research planner belum diimplementasikan. Lanjutkan Task 2.');
}
