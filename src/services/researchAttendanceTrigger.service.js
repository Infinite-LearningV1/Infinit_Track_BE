import Holidays from 'date-holidays';

import config from '../config/index.js';

const TARGET_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const APPLY_CONFIRMATION = 'I_UNDERSTAND_THIS_WRITES_ATTENDANCE';
const DAILY_SUBSET_PERCENT = 0.3;

const ATTENDANCE_CATEGORY_IDS = Object.freeze({ WFO: 1, WFH: 2, WFA: 3 });
const ATTENDANCE_STATUS_IDS = Object.freeze({ ONTIME: 1, LATE: 2, ALPHA: 3, EARLY: 4 });
const BOOKING_STATUS_IDS = Object.freeze({ APPROVED: 1 });

function createHttpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeTriggerRequest(body = {}) {
  return {
    targetDate: typeof body.target_date === 'string' ? body.target_date.trim() : '',
    dryRun: body.dry_run !== false,
    allowNonWorkingDay: body.allow_non_working_day === true,
    confirm: typeof body.confirm === 'string' ? body.confirm.trim() : ''
  };
}

function validateTriggerRequest(request) {
  if (!config.researchAttendanceTriggerEnabled) {
    throw createHttpError(
      409,
      'E_FEATURE_DISABLED',
      'Research attendance trigger endpoint sedang dinonaktifkan.'
    );
  }

  if (!request.targetDate) {
    throw createHttpError(400, 'E_TARGET_DATE_REQUIRED', 'target_date wajib diisi.');
  }

  if (!TARGET_DATE_PATTERN.test(request.targetDate)) {
    throw createHttpError(400, 'E_INVALID_TARGET_DATE', 'target_date harus berformat YYYY-MM-DD.');
  }

  if (!request.dryRun && !request.confirm) {
    throw createHttpError(
      400,
      'E_CONFIRMATION_REQUIRED',
      'confirm wajib diisi saat dry_run=false.'
    );
  }

  if (!request.dryRun && request.confirm !== APPLY_CONFIRMATION) {
    throw createHttpError(
      400,
      'E_INVALID_CONFIRMATION',
      'confirm harus sama persis dengan acknowledgement yang diwajibkan.'
    );
  }
}

function defaultIsNonWorkingDay(targetDate) {
  const date = new Date(`${targetDate}T12:00:00+07:00`);
  const day = date.getUTCDay();
  const isWeekend = day === 0 || day === 6;
  const holidays = new Holidays('ID');
  const isHoliday = Boolean(holidays.isHoliday(date));
  return isWeekend || isHoliday;
}

function normalizeRoleGroup(roleName) {
  if (roleName === 'Internship') {
    return 'internship';
  }

  if (roleName === 'Admin' || roleName === 'Management') {
    return 'admin_management';
  }

  return 'employee';
}

function allocateCounts(total, mix) {
  const entries = Object.entries(mix).map(([key, percent]) => {
    const raw = (total * percent) / 100;
    const floor = Math.floor(raw);
    return {
      key,
      floor,
      fraction: raw - floor
    };
  });

  let remaining = total - entries.reduce((sum, entry) => sum + entry.floor, 0);
  entries.sort((left, right) => right.fraction - left.fraction || left.key.localeCompare(right.key));

  for (const entry of entries) {
    if (remaining <= 0) {
      break;
    }
    entry.floor += 1;
    remaining -= 1;
  }

  return Object.fromEntries(entries.map((entry) => [entry.key, entry.floor]));
}

function buildTimestamp(dateString, hour, minute = 0) {
  return `${dateString} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function createSeededNumberStream(seed) {
  let state = 0;

  for (const char of String(seed)) {
    state = (state * 31 + char.charCodeAt(0)) >>> 0;
  }

  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

async function buildDeterministicOrder(items, seed, keySelector) {
  const nextRandom = createSeededNumberStream(seed);

  return items
    .slice()
    .sort((left, right) => keySelector(left) - keySelector(right))
    .map((item) => ({ item, score: nextRandom() }))
    .sort((left, right) => left.score - right.score || keySelector(left.item) - keySelector(right.item))
    .map((entry) => entry.item);
}

async function selectDailyUsers({ eligibleUsers, targetCount, seed }) {
  const groupedUsers = {
    internship: eligibleUsers.filter((user) => normalizeRoleGroup(user.role_name) === 'internship'),
    employee: eligibleUsers.filter((user) => normalizeRoleGroup(user.role_name) === 'employee'),
    admin_management: eligibleUsers.filter(
      (user) => normalizeRoleGroup(user.role_name) === 'admin_management'
    )
  };

  const quotas = allocateCounts(targetCount, {
    internship: 80,
    employee: 18,
    admin_management: 2
  });

  const selectedUsers = [];
  const selectedIds = new Set();

  for (const [groupName, users] of Object.entries(groupedUsers)) {
    const orderedGroup = await buildDeterministicOrder(
      users,
      `${seed}:${groupName}`,
      (user) => user.userId
    );
    const takeCount = Math.min(orderedGroup.length, quotas[groupName]);

    for (const user of orderedGroup.slice(0, takeCount)) {
      selectedUsers.push(user);
      selectedIds.add(user.userId);
    }
  }

  if (selectedUsers.length < targetCount) {
    const remainingUsers = eligibleUsers.filter((user) => !selectedIds.has(user.userId));
    const orderedRemainingUsers = await buildDeterministicOrder(
      remainingUsers,
      `${seed}:remaining`,
      (user) => user.userId
    );

    for (const user of orderedRemainingUsers) {
      if (selectedUsers.length >= targetCount) {
        break;
      }
      selectedUsers.push(user);
      selectedIds.add(user.userId);
    }
  }

  return buildDeterministicOrder(selectedUsers, `${seed}:selected`, (user) => user.userId);
}

async function assignModes(selectedUsers, seed) {
  const orderedUsers = await buildDeterministicOrder(selectedUsers, `${seed}:modes`, (user) => user.userId);
  const modeCounts = allocateCounts(selectedUsers.length, { WFO: 80, WFA: 5, WFH: 15 });
  const userModes = new Map();

  let cursor = 0;
  for (const modeName of ['WFO', 'WFA', 'WFH']) {
    for (const user of orderedUsers.slice(cursor, cursor + modeCounts[modeName])) {
      userModes.set(user.userId, modeName);
    }
    cursor += modeCounts[modeName];
  }

  for (const user of orderedUsers.slice(cursor)) {
    userModes.set(user.userId, 'WFO');
  }

  return userModes;
}

function selectApprovedBooking(existingBookingRows, userId, targetDate) {
  return existingBookingRows
    .filter(
      (booking) =>
        booking.user_id === userId &&
        booking.schedule_date === targetDate &&
        booking.status === BOOKING_STATUS_IDS.APPROVED
    )
    .sort((left, right) => left.booking_id - right.booking_id)[0] || null;
}

function mergeRows(existingRows, additionalRows, keySelector) {
  const mergedRows = existingRows.slice();
  const seenKeys = new Set(existingRows.map(keySelector));

  for (const row of additionalRows) {
    const key = keySelector(row);
    if (!seenKeys.has(key)) {
      mergedRows.push(row);
      seenKeys.add(key);
    }
  }

  return mergedRows;
}

export async function collectTriggerSnapshotForDate(targetDate) {
  const { collectDatabaseSnapshot } = await import('../../scripts/research/generate-attendance-dataset.js');
  const { Attendance, Booking, LocationEvent, User, Role, sequelize } = await import('../models/index.js');

  const snapshot = await collectDatabaseSnapshot();
  const targetDateAttendanceRows = await Attendance.findAll({
    where: { attendance_date: targetDate },
    raw: true
  });
  const targetDateBookingRows = await Booking.findAll({
    where: { schedule_date: targetDate },
    raw: true
  });
  const targetDateLocationEventRows = await LocationEvent.findAll({
    where: {
      event_timestamp: {
        [sequelize.Sequelize.Op.gte]: `${targetDate} 00:00:00`,
        [sequelize.Sequelize.Op.lt]: `${targetDate} 23:59:59`
      }
    },
    raw: true
  });

  const baselineUsers = snapshot.baselineUsers.length
    ? await User.findAll({
        attributes: ['id_users', 'full_name'],
        where: {
          id_users: snapshot.baselineUsers.map((user) => user.userId),
          deleted_at: null
        },
        include: [
          {
            model: Role,
            as: 'role',
            attributes: ['role_name']
          }
        ],
        raw: true,
        nest: true
      })
    : [];

  return {
    ...snapshot,
    baselineUsers: baselineUsers.map((user) => ({
      userId: user.id_users,
      fullName: user.full_name,
      role_name: user.role?.role_name || 'Employee'
    })),
    existingAttendanceRows: mergeRows(
      snapshot.existingAttendanceRows || [],
      targetDateAttendanceRows,
      (row) => `${row.user_id}:${row.attendance_date}`
    ),
    existingBookingRows: mergeRows(
      snapshot.existingBookingRows || [],
      targetDateBookingRows,
      (row) => `${row.booking_id}`
    ),
    existingLocationEvents: mergeRows(
      snapshot.existingLocationEvents || [],
      targetDateLocationEventRows,
      (row) => `${row.id}`
    )
  };
}

export async function buildResearchAttendanceTriggerPlan({
  endpointType,
  targetDate,
  seed,
  request,
  snapshot,
  user
}) {
  void user;

  const eligibleUsers = snapshot.baselineUsers.slice().sort((left, right) => left.userId - right.userId);
  const baselineUserCount = eligibleUsers.length;
  const eligibleUserCount = eligibleUsers.length;
  const targetCount = endpointType === 'full-day'
    ? eligibleUserCount
    : eligibleUserCount === 0
      ? 0
      : Math.min(eligibleUserCount, Math.max(1, Math.round(eligibleUserCount * DAILY_SUBSET_PERCENT)));

  const selectedUsers = endpointType === 'full-day'
    ? await buildDeterministicOrder(eligibleUsers, `${seed}:full-day`, (userEntry) => userEntry.userId)
    : await selectDailyUsers({ eligibleUsers, targetCount, seed });

  const modeAssignments = await assignModes(selectedUsers, seed);
  const existingAttendanceKeys = new Set(
    (snapshot.existingAttendanceRows || []).map((row) => `${row.user_id}:${row.attendance_date}`)
  );

  const plannedAttendanceRows = [];
  const plannedBookingRows = [];
  const plannedLocationEventRows = [];
  const conflicts = [];
  const warnings = [];
  let skippedExisting = 0;
  let skippedConflict = 0;
  let invalidReferenceCount = 0;

  for (const selectedUser of selectedUsers) {
    const attendanceKey = `${selectedUser.userId}:${targetDate}`;
    if (existingAttendanceKeys.has(attendanceKey)) {
      skippedExisting += 1;
      continue;
    }

    const modeName = modeAssignments.get(selectedUser.userId) || 'WFO';
    const expectedLocations = snapshot.expectedLocationsByUser?.[selectedUser.userId] || {};

    const attendanceRow = {
      user_id: selectedUser.userId,
      attendance_date: targetDate,
      category_id: ATTENDANCE_CATEGORY_IDS[modeName],
      status_id: ATTENDANCE_STATUS_IDS.ONTIME,
      booking_id: null,
      location_id: null,
      time_in: buildTimestamp(targetDate, 8, 0),
      time_out: buildTimestamp(targetDate, 17, 0),
      work_hour: 8,
      notes: 'Kehadiran tercatat melalui research attendance trigger operator.'
    };

    if (modeName === 'WFO') {
      attendanceRow.location_id = expectedLocations.wfoLocationId || null;
    }

    if (modeName === 'WFH') {
      attendanceRow.location_id = expectedLocations.wfhLocationId || null;
    }

    if (modeName === 'WFA') {
      const approvedBooking = selectApprovedBooking(
        snapshot.existingBookingRows || [],
        selectedUser.userId,
        targetDate
      );

      if (approvedBooking) {
        attendanceRow.booking_id = approvedBooking.booking_id;
        attendanceRow.location_id = approvedBooking.location_id;
      } else if (expectedLocations.fallbackWfaLocationId) {
        attendanceRow.location_id = expectedLocations.fallbackWfaLocationId;
        plannedBookingRows.push({
          user_id: selectedUser.userId,
          schedule_date: targetDate,
          location_id: expectedLocations.fallbackWfaLocationId,
          status: BOOKING_STATUS_IDS.APPROVED,
          notes: 'Kehadiran WFA tercatat sesuai lokasi yang disetujui.'
        });
      }
    }

    if (!attendanceRow.location_id) {
      skippedConflict += 1;
      invalidReferenceCount += 1;
      conflicts.push({
        type: 'invalid_reference',
        user_id: selectedUser.userId,
        target_date: targetDate,
        mode: modeName
      });
      continue;
    }

    plannedAttendanceRows.push(attendanceRow);
    plannedLocationEventRows.push(
      {
        user_id: selectedUser.userId,
        location_id: attendanceRow.location_id,
        event_type: 'ENTER',
        event_date: targetDate
      },
      {
        user_id: selectedUser.userId,
        location_id: attendanceRow.location_id,
        event_type: 'EXIT',
        event_date: targetDate
      }
    );
  }

  if (selectedUsers.length === 0) {
    throw createHttpError(409, 'E_NO_ELIGIBLE_USERS', 'Tidak ada eligible users untuk target_date ini.');
  }

  if (plannedAttendanceRows.length === 0 && skippedExisting === selectedUsers.length) {
    warnings.push('Semua user target sudah memiliki attendance pada tanggal yang diminta.');
  }

  return {
    policy: {
      allow_non_working_day: request.allowNonWorkingDay,
      skip_existing: true,
      daily_subset_percent: endpointType === 'daily' ? 30 : undefined
    },
    population: {
      source: 'existing July 2025 attendance baseline',
      baseline_user_count: baselineUserCount,
      eligible_user_count: eligibleUserCount,
      selected_user_count: selectedUsers.length
    },
    selection_summary: endpointType === 'daily'
      ? {
          strategy: 'fixed-percentage',
          subset_percent: 30,
          target_user_ids: selectedUsers.map((selectedUser) => selectedUser.userId)
        }
      : {
          strategy: 'full-population',
          target_user_ids: selectedUsers.map((selectedUser) => selectedUser.userId)
        },
    mode_summary: {
      wfo: plannedAttendanceRows.filter((row) => row.category_id === ATTENDANCE_CATEGORY_IDS.WFO).length,
      wfh: plannedAttendanceRows.filter((row) => row.category_id === ATTENDANCE_CATEGORY_IDS.WFH).length,
      wfa: plannedAttendanceRows.filter((row) => row.category_id === ATTENDANCE_CATEGORY_IDS.WFA).length
    },
    warnings,
    conflicts,
    skipped_existing: skippedExisting,
    skipped_conflict: skippedConflict,
    invalid_reference_count: invalidReferenceCount,
    plannedAttendanceRows,
    plannedBookingRows,
    plannedLocationEventRows
  };
}

async function defaultBuildPlan({ endpointType, targetDate, seed, request, snapshot, user }) {
  return buildResearchAttendanceTriggerPlan({
    endpointType,
    targetDate,
    seed,
    request,
    snapshot,
    user
  });
}

export async function applyResearchAttendancePlanInTransaction(plan) {
  const { applyResearchAttendancePlan } = await import(
    '../../scripts/research/generate-attendance-dataset.js'
  );
  const { sequelize } = await import('../models/index.js');
  const transaction = await sequelize.transaction();

  try {
    const result = await applyResearchAttendancePlan({ plan, transaction });
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

function buildDryRunResponse({ endpointType, request, plan, seed }) {
  return {
    success: true,
    endpoint_type: endpointType,
    mode: 'dry-run',
    target_date: request.targetDate,
    seed,
    policy: plan.policy,
    population: plan.population,
    mode_summary: plan.mode_summary,
    selection_summary: plan.selection_summary,
    warnings: plan.warnings,
    conflicts: plan.conflicts,
    planned_writes: {
      attendance: plan.plannedAttendanceRows.length,
      bookings: plan.plannedBookingRows.length,
      location_events: plan.plannedLocationEventRows.length
    },
    skipped_existing: plan.skipped_existing,
    skipped_conflict: plan.skipped_conflict
  };
}

function buildApplyResponse({ endpointType, request, plan, seed, appliedWrites }) {
  return {
    success: true,
    endpoint_type: endpointType,
    mode: 'apply',
    target_date: request.targetDate,
    seed,
    policy: plan.policy,
    population: plan.population,
    mode_summary: plan.mode_summary,
    selection_summary: plan.selection_summary,
    warnings: plan.warnings,
    conflicts: plan.conflicts,
    applied_writes: appliedWrites,
    skipped_existing: plan.skipped_existing,
    skipped_conflict: plan.skipped_conflict
  };
}

export async function executeResearchAttendanceTrigger({
  endpointType,
  body = {},
  user = null,
  dependencies = {}
}) {
  const request = normalizeTriggerRequest(body);
  validateTriggerRequest(request);

  const isNonWorkingDay = dependencies.isNonWorkingDay || defaultIsNonWorkingDay;
  if (!request.allowNonWorkingDay && isNonWorkingDay(request.targetDate)) {
    throw createHttpError(
      409,
      'E_NON_WORKING_DAY',
      'target_date jatuh pada hari libur atau akhir pekan dan override tidak diizinkan.'
    );
  }

  const seed = `${request.targetDate}:${endpointType === 'daily' ? 'daily' : 'full-day'}`;
  const collectSnapshot = dependencies.collectSnapshot || (() => collectTriggerSnapshotForDate(request.targetDate));
  const buildPlan = dependencies.buildPlan || defaultBuildPlan;
  const applyPlan = dependencies.applyPlan || ((payload) => applyResearchAttendancePlanInTransaction(payload.plan));

  const snapshot = await collectSnapshot();
  const plan = await buildPlan({ endpointType, targetDate: request.targetDate, seed, request, snapshot, user });

  if (request.dryRun) {
    return buildDryRunResponse({ endpointType, request, plan, seed });
  }

  if (plan.invalid_reference_count > 0) {
    throw createHttpError(
      500,
      'E_INVALID_REFERENCE_STATE',
      'Reference state tidak valid untuk apply research attendance trigger.'
    );
  }

  const appliedWrites = await applyPlan({
    endpointType,
    targetDate: request.targetDate,
    seed,
    request,
    snapshot,
    plan,
    user
  });
  return buildApplyResponse({ endpointType, request, plan, seed, appliedWrites });
}

export { APPLY_CONFIRMATION };
