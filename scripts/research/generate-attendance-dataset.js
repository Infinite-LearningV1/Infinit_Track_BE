#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import Holidays from 'date-holidays';

import config from '../../src/config/index.js';
import {
  Attendance,
  Booking,
  Location,
  LocationEvent,
  User,
  sequelize
} from '../../src/models/index.js';
import {
  APPLY_ACK_FLAG,
  FIXED_OUTPUT_PATH,
  RESEARCH_ATTENDANCE_CONFIG
} from './research-attendance-config.js';

export function assertApplyGuard(args) {
  if (args.apply && !args.acknowledged) {
    throw new Error('Apply mode requires --apply and --i-understand-this-writes-attendance-data.');
  }
}

export function parseArgs(argv = []) {
  const apply = argv.includes('--apply');
  const acknowledged = argv.includes(APPLY_ACK_FLAG);
  const args = {
    apply,
    acknowledged,
    dryRun: !apply,
    outputPath: FIXED_OUTPUT_PATH
  };

  assertApplyGuard(args);
  return args;
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

function compareExistingBookingRows(left, right) {
  return left.user_id - right.user_id ||
    String(left.schedule_date).localeCompare(String(right.schedule_date)) ||
    left.status - right.status ||
    left.booking_id - right.booking_id;
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
  const stableExistingBookingRows = existingBookingRows
    .slice()
    .sort(compareExistingBookingRows);

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
      const existingBooking = stableExistingBookingRows.find(
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

function getCreatedBookingId(row) {
  if (row?.booking_id !== undefined) {
    return row.booking_id;
  }
  if (typeof row?.get === 'function') {
    return row.get('booking_id');
  }
  return undefined;
}

function buildBookingLookupKey(row) {
  return `${row.user_id}:${row.schedule_date}:${row.location_id}`;
}

export async function applyResearchAttendancePlan({
  plan,
  transaction,
  models = { Booking, Attendance, LocationEvent }
}) {
  const appliedAt = new Date();
  let insertedBookingRows = [];

  if (plan.plannedBookingRows.length > 0) {
    insertedBookingRows = await models.Booking.bulkCreate(
      plan.plannedBookingRows.map((row) => ({
        ...row,
        created_at: row.created_at ?? appliedAt
      })),
      { transaction }
    );
  }

  const insertedBookingIdsByKey = new Map(
    insertedBookingRows.map((row, index) => [
      buildBookingLookupKey(plan.plannedBookingRows[index]),
      getCreatedBookingId(row)
    ])
  );

  if (plan.plannedAttendanceRows.length > 0) {
    await models.Attendance.bulkCreate(
      plan.plannedAttendanceRows.map((row) => ({
        ...row,
        booking_id: row.booking_id ?? insertedBookingIdsByKey.get(
          buildBookingLookupKey({
            user_id: row.user_id,
            schedule_date: row.attendance_date,
            location_id: row.location_id
          })
        ) ?? null,
        created_at: row.created_at ?? appliedAt,
        updated_at: row.updated_at ?? appliedAt
      })),
      { transaction }
    );
  }
  if (plan.plannedLocationEventRows.length > 0) {
    await models.LocationEvent.bulkCreate(
      plan.plannedLocationEventRows.map((row) => ({
        ...row,
        event_timestamp:
          row.event_timestamp ||
          `${row.event_date} ${row.event_type === 'ENTER' ? '08:00:00' : '17:00:00'}`
      })),
      { transaction }
    );
  }

  return {
    attendance: plan.plannedAttendanceRows.length,
    bookings: plan.plannedBookingRows.length,
    locationEvents: plan.plannedLocationEventRows.length
  };
}

export async function collectDatabaseSnapshot(models = {
  Attendance,
  Booking,
  Location,
  LocationEvent,
  User
}) {
  const julyAttendanceRows = await models.Attendance.findAll({
    attributes: ['user_id'],
    where: {
      attendance_date: {
        [sequelize.Sequelize.Op.gte]: '2025-07-01',
        [sequelize.Sequelize.Op.lte]: '2025-07-31'
      }
    },
    group: ['user_id'],
    raw: true
  });

  const baselineUserIds = julyAttendanceRows.map((row) => row.user_id);
  const baselineUsers = baselineUserIds.length
    ? await models.User.findAll({
        attributes: ['id_users', 'full_name'],
        where: {
          id_users: baselineUserIds,
          deleted_at: null
        },
        raw: true
      })
    : [];

  const existingAttendanceRows = await models.Attendance.findAll({
    where: {
      attendance_date: {
        [sequelize.Sequelize.Op.gte]: '2025-07-01',
        [sequelize.Sequelize.Op.lte]: '2026-06-26'
      }
    },
    raw: true
  });

  const existingBookingRows = await models.Booking.findAll({
    where: {
      schedule_date: {
        [sequelize.Sequelize.Op.gte]: '2025-07-01',
        [sequelize.Sequelize.Op.lte]: '2026-06-26'
      }
    },
    order: [
      ['user_id', 'ASC'],
      ['schedule_date', 'ASC'],
      ['status', 'ASC'],
      ['booking_id', 'ASC']
    ],
    raw: true
  });

  const existingLocationEvents = await models.LocationEvent.findAll({
    where: {
      event_timestamp: {
        [sequelize.Sequelize.Op.gte]: '2025-07-01 00:00:00',
        [sequelize.Sequelize.Op.lt]: '2026-06-27 00:00:00'
      }
    },
    raw: true
  });

  const locationRows = await models.Location.findAll({
    attributes: ['location_id', 'user_id', 'id_attendance_categories'],
    order: [
      ['id_attendance_categories', 'ASC'],
      ['user_id', 'ASC'],
      ['location_id', 'ASC']
    ],
    raw: true
  });

  const globalWfoLocation =
    locationRows.find(
      (row) => row.id_attendance_categories === ATTENDANCE_CATEGORY_IDS.WFO && row.user_id == null
    ) || null;

  const expectedLocationsByUser = {};

  for (const user of baselineUsers) {
    const userLocations = locationRows.filter((row) => row.user_id === user.id_users);
    const userBookings = existingBookingRows.filter(
      (row) => row.user_id === user.id_users && row.status === BOOKING_STATUS_IDS.APPROVED
    );
    const latestApprovedBooking = userBookings.length ? userBookings[userBookings.length - 1] : null;
    const explicitWfaLocation =
      userLocations.find((row) => row.id_attendance_categories === ATTENDANCE_CATEGORY_IDS.WFA) || null;
    const wfhLocation =
      userLocations.find((row) => row.id_attendance_categories === ATTENDANCE_CATEGORY_IDS.WFH) || null;

    expectedLocationsByUser[user.id_users] = {
      wfoLocationId: globalWfoLocation?.location_id ?? null,
      wfhLocationId: wfhLocation?.location_id ?? null,
      fallbackWfaLocationId: latestApprovedBooking?.location_id ?? explicitWfaLocation?.location_id ?? null
    };
  }

  return {
    dbIdentity: {
      host: config.db.host,
      port: Number(config.db.port),
      database: config.db.database
    },
    baselineUsers: baselineUsers.map((row) => ({ userId: row.id_users, fullName: row.full_name })),
    existingAttendanceRows,
    existingBookingRows,
    existingLocationEvents,
    expectedLocationsByUser,
    lookupValidation: { ok: true },
    missingDeletedBaselineUsers: baselineUserIds
      .filter((userId) => !baselineUsers.some((user) => user.id_users === userId))
      .map((userId) => ({ userId }))
  };
}

export function buildDryRunSummary({ args, snapshot, plan }) {
  return {
    runMode: args.apply ? 'apply' : 'dry-run',
    deterministicSeed: RESEARCH_ATTENDANCE_CONFIG.seed,
    dbIdentity: snapshot.dbIdentity,
    lookupValidation: snapshot.lookupValidation,
    population: plan.population,
    calendar: plan.calendar,
    blackoutMonths: RESEARCH_ATTENDANCE_CONFIG.blackoutMonths,
    existingSkipped: plan.existingSkipped,
    plannedWrites: {
      attendance: plan.plannedAttendanceRows.length,
      bookings: plan.plannedBookingRows.length,
      locationEvents: plan.plannedLocationEventRows.length
    },
    monthlySummaries: plan.monthlySummaries,
    fkValidation: plan.fkValidation || { ok: true },
    potentialConflicts: plan.potentialConflicts,
    needsVerification: plan.needsVerification
  };
}

export async function writeSummaryArtifact(summary, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(summary, null, 2));
  return outputPath;
}

export function formatDryRunReport(summary) {
  return [
    `DB host: ${summary.dbIdentity.host}`,
    `DB port: ${summary.dbIdentity.port}`,
    `DB name: ${summary.dbIdentity.database}`,
    `population source: ${summary.population.source}`,
    `population count: ${summary.population.count}`,
    `blackout months: ${summary.blackoutMonths.join(', ')}`,
    `existing attendance skipped: ${summary.existingSkipped}`,
    `planned attendance writes: ${summary.plannedWrites.attendance}`,
    `planned booking writes: ${summary.plannedWrites.bookings}`,
    `planned location_event writes: ${summary.plannedWrites.locationEvents}`
  ].join('\n');
}

export async function runCli(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  const snapshot = await collectDatabaseSnapshot();
  const plan = buildResearchAttendancePlan({
    config: RESEARCH_ATTENDANCE_CONFIG,
    baselineUsers: snapshot.baselineUsers,
    existingAttendanceRows: snapshot.existingAttendanceRows,
    existingBookingRows: snapshot.existingBookingRows,
    existingLocationEvents: snapshot.existingLocationEvents,
    expectedLocationsByUser: snapshot.expectedLocationsByUser,
    holidays: new Holidays('ID')
  });
  const summary = buildDryRunSummary({ args, snapshot, plan });
  const outputPath = await writeSummaryArtifact(summary, args.outputPath);
  io.log(formatDryRunReport(summary));

  if (!args.apply) {
    return { summary, outputPath, plan, args, snapshot };
  }

  io.log('APPLY MODE WRITE TARGET');
  io.log(`DB host: ${summary.dbIdentity.host}`);
  io.log(`DB port: ${summary.dbIdentity.port}`);
  io.log(`DB name: ${summary.dbIdentity.database}`);
  io.log(`planned attendance writes: ${summary.plannedWrites.attendance}`);
  io.log(`planned booking writes: ${summary.plannedWrites.bookings}`);
  io.log(`planned location_event writes: ${summary.plannedWrites.locationEvents}`);

  const transaction = await sequelize.transaction();
  try {
    const writtenCounts = await applyResearchAttendancePlan({ plan, transaction });
    await transaction.commit();
    return { summary: { ...summary, applyAttempted: true, writtenCounts }, outputPath, plan, args, snapshot };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export function isDirectRun(metaUrl) {
  return process.argv[1] === fileURLToPath(metaUrl);
}

if (isDirectRun(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
