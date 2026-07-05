import Holidays from 'date-holidays';

import config from '../config/index.js';

const TARGET_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SEED_SUFFIX_PATTERN = /^[A-Za-z0-9._-]+$/;
const APPLY_CONFIRMATION = 'I_UNDERSTAND_THIS_WRITES_ATTENDANCE';
const DAILY_SUBSET_PERCENT = 0.3;
const DEFAULT_DISCIPLINE_MIX = Object.freeze({ ontime: 75, late: 12, early: 8, alpha: 5 });
const DISCIPLINE_SEQUENCE = ['ontime', 'late', 'early', 'alpha'];
const VALID_EXISTING_STRATEGIES = new Set(['skip', 'replace']);
const RESEARCH_TRIGGER_ATTENDANCE_NOTE =
  'Kehadiran tercatat melalui research attendance trigger operator.';
const RESEARCH_TRIGGER_BOOKING_NOTE = 'Kehadiran WFA tercatat sesuai lokasi yang disetujui.';
const REPLACE_LOCATION_EVENT_WARNING =
  'existing_strategy=replace akan menghapus location events existing pada level user+tanggal untuk attendance research-owned karena location_events tidak memiliki marker research-owned.';
const LATE_BUCKETS = Object.freeze([
  { key: 'light', minMinutes: 8 * 60 + 10, maxMinutes: 8 * 60 + 30 },
  { key: 'medium', minMinutes: 8 * 60 + 31, maxMinutes: 8 * 60 + 55 },
  { key: 'heavy', minMinutes: 8 * 60 + 56, maxMinutes: 9 * 60 + 30 }
]);
const EARLY_CHECKOUT_RANGE = Object.freeze({ minMinutes: 15 * 60 + 30, maxMinutes: 16 * 60 + 30 });
const STANDARD_WORK_START_MINUTES = 8 * 60;
const STANDARD_WORK_END_MINUTES = 17 * 60;

const ATTENDANCE_CATEGORY_IDS = Object.freeze({ WFO: 1, WFH: 2, WFA: 3 });
const ATTENDANCE_STATUS_IDS = Object.freeze({ ONTIME: 1, LATE: 2, ALPHA: 3, EARLY: 4 });
const BOOKING_STATUS_IDS = Object.freeze({ APPROVED: 1 });

function createHttpError(status, code, message, extra = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function normalizeTriggerRequest(body = {}) {
  const disciplineMixRaw =
    body.discipline_mix && typeof body.discipline_mix === 'object' && !Array.isArray(body.discipline_mix)
      ? body.discipline_mix
      : null;

  return {
    targetDate: typeof body.target_date === 'string' ? body.target_date.trim() : '',
    dryRun: body.dry_run !== false,
    allowNonWorkingDay: body.allow_non_working_day === true,
    confirm: typeof body.confirm === 'string' ? body.confirm.trim() : '',
    seedSuffix: typeof body.seed_suffix === 'string' ? body.seed_suffix.trim() : '',
    existingStrategy:
      typeof body.existing_strategy === 'string' && body.existing_strategy.trim()
        ? body.existing_strategy.trim().toLowerCase()
        : 'skip',
    disciplineMix: normalizeDisciplineMix(disciplineMixRaw)
  };
}

function normalizeDisciplineMix(disciplineMixRaw) {
  if (!disciplineMixRaw) {
    return { ...DEFAULT_DISCIPLINE_MIX };
  }

  return {
    ontime: Number(disciplineMixRaw.ontime ?? 0),
    late: Number(disciplineMixRaw.late ?? 0),
    early: Number(disciplineMixRaw.early ?? 0),
    alpha: Number(disciplineMixRaw.alpha ?? 0)
  };
}

function validateSeedSuffix(seedSuffix) {
  if (!seedSuffix) {
    return;
  }

  if (seedSuffix.length > 80) {
    throw createHttpError(
      400,
      'E_INVALID_SEED_SUFFIX',
      'seed_suffix maksimal 80 karakter.'
    );
  }

  if (!SEED_SUFFIX_PATTERN.test(seedSuffix)) {
    throw createHttpError(
      400,
      'E_INVALID_SEED_SUFFIX',
      'seed_suffix hanya boleh berisi huruf, angka, titik, dash, atau underscore.'
    );
  }
}

function validateDisciplineMix(disciplineMix) {
  const values = Object.entries(disciplineMix);
  for (const [key, value] of values) {
    if (!Number.isFinite(value) || value < 0) {
      throw createHttpError(
        400,
        'E_INVALID_DISCIPLINE_MIX',
        `discipline_mix.${key} harus berupa angka non-negatif.`
      );
    }
  }

  const total = values.reduce((sum, [, value]) => sum + value, 0);
  if (Math.abs(total - 100) > 0.001) {
    throw createHttpError(
      400,
      'E_INVALID_DISCIPLINE_MIX',
      'discipline_mix harus berjumlah total 100.'
    );
  }
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

  if (!VALID_EXISTING_STRATEGIES.has(request.existingStrategy)) {
    throw createHttpError(
      400,
      'E_INVALID_EXISTING_STRATEGY',
      'existing_strategy hanya boleh bernilai skip atau replace.'
    );
  }

  validateSeedSuffix(request.seedSuffix);
  validateDisciplineMix(request.disciplineMix);

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

function buildTimestampFromMinutes(dateString, totalMinutes) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return buildTimestamp(dateString, hour, minute);
}

function calculateWorkHour(startMinutes, endMinutes) {
  const workedMinutes = Math.max(0, endMinutes - startMinutes);
  return Math.round((workedMinutes / 60) * 100) / 100;
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

function buildDeterministicOrder(items, seed, keySelector) {
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
    const orderedGroup = buildDeterministicOrder(users, `${seed}:${groupName}`, (user) => user.userId);
    const takeCount = Math.min(orderedGroup.length, quotas[groupName]);

    for (const user of orderedGroup.slice(0, takeCount)) {
      selectedUsers.push(user);
      selectedIds.add(user.userId);
    }
  }

  if (selectedUsers.length < targetCount) {
    const remainingUsers = eligibleUsers.filter((user) => !selectedIds.has(user.userId));
    const orderedRemainingUsers = buildDeterministicOrder(
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

function assignModes(selectedUsers, seed) {
  const orderedUsers = buildDeterministicOrder(selectedUsers, `${seed}:modes`, (user) => user.userId);
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

function assignDisciplineStatuses(selectedUsers, seed, disciplineMix) {
  const orderedUsers = buildDeterministicOrder(
    selectedUsers,
    `${seed}:discipline`,
    (user) => user.userId
  );
  const disciplineCounts = allocateCounts(selectedUsers.length, disciplineMix);
  const assignments = new Map();

  let cursor = 0;
  for (const disciplineName of DISCIPLINE_SEQUENCE) {
    for (const user of orderedUsers.slice(cursor, cursor + disciplineCounts[disciplineName])) {
      assignments.set(user.userId, disciplineName);
    }
    cursor += disciplineCounts[disciplineName];
  }

  for (const user of orderedUsers.slice(cursor)) {
    assignments.set(user.userId, 'ontime');
  }

  return {
    assignments,
    counts: disciplineCounts
  };
}

function buildAttendanceTimingForDiscipline(statusName, targetDate, seed, userId) {
  const nextRandom = createSeededNumberStream(`${seed}:${statusName}:${userId}`);

  if (statusName === 'alpha') {
    const alphaTimestamp = buildTimestamp(targetDate, 8, 0);
    return {
      statusId: ATTENDANCE_STATUS_IDS.ALPHA,
      categoryId: ATTENDANCE_CATEGORY_IDS.WFO,
      timeIn: alphaTimestamp,
      timeOut: alphaTimestamp,
      workHour: 0,
      eventTimestamps: null,
      isPresent: false
    };
  }

  if (statusName === 'late') {
    const bucket = LATE_BUCKETS[Math.floor(nextRandom() * LATE_BUCKETS.length)] || LATE_BUCKETS[0];
    const bucketSpan = bucket.maxMinutes - bucket.minMinutes + 1;
    const timeInMinutes = bucket.minMinutes + Math.floor(nextRandom() * bucketSpan);
    const timeOutMinutes = STANDARD_WORK_END_MINUTES;

    return {
      statusId: ATTENDANCE_STATUS_IDS.LATE,
      timeIn: buildTimestampFromMinutes(targetDate, timeInMinutes),
      timeOut: buildTimestampFromMinutes(targetDate, timeOutMinutes),
      workHour: calculateWorkHour(timeInMinutes, timeOutMinutes),
      eventTimestamps: {
        enter: buildTimestampFromMinutes(targetDate, timeInMinutes),
        exit: buildTimestampFromMinutes(targetDate, timeOutMinutes)
      },
      isPresent: true
    };
  }

  if (statusName === 'early') {
    const checkoutSpan = EARLY_CHECKOUT_RANGE.maxMinutes - EARLY_CHECKOUT_RANGE.minMinutes + 1;
    const timeOutMinutes =
      EARLY_CHECKOUT_RANGE.minMinutes + Math.floor(nextRandom() * checkoutSpan);
    const timeInMinutes = STANDARD_WORK_START_MINUTES;

    return {
      statusId: ATTENDANCE_STATUS_IDS.EARLY,
      timeIn: buildTimestampFromMinutes(targetDate, timeInMinutes),
      timeOut: buildTimestampFromMinutes(targetDate, timeOutMinutes),
      workHour: calculateWorkHour(timeInMinutes, timeOutMinutes),
      eventTimestamps: {
        enter: buildTimestampFromMinutes(targetDate, timeInMinutes),
        exit: buildTimestampFromMinutes(targetDate, timeOutMinutes)
      },
      isPresent: true
    };
  }

  return {
    statusId: ATTENDANCE_STATUS_IDS.ONTIME,
    timeIn: buildTimestampFromMinutes(targetDate, STANDARD_WORK_START_MINUTES),
    timeOut: buildTimestampFromMinutes(targetDate, STANDARD_WORK_END_MINUTES),
    workHour: calculateWorkHour(STANDARD_WORK_START_MINUTES, STANDARD_WORK_END_MINUTES),
    eventTimestamps: {
      enter: buildTimestampFromMinutes(targetDate, STANDARD_WORK_START_MINUTES),
      exit: buildTimestampFromMinutes(targetDate, STANDARD_WORK_END_MINUTES)
    },
    isPresent: true
  };
}

function buildTriggerSeed(request, endpointType) {
  const baseSeed = `${request.targetDate}:${endpointType === 'daily' ? 'daily' : 'full-day'}`;
  return request.seedSuffix ? `${baseSeed}:${request.seedSuffix}` : baseSeed;
}

function selectApprovedBooking(existingBookingRows, userId, targetDate) {
  return (
    existingBookingRows
      .filter(
        (booking) =>
          booking.user_id === userId &&
          booking.schedule_date === targetDate &&
          booking.status === BOOKING_STATUS_IDS.APPROVED
      )
      .sort((left, right) => left.booking_id - right.booking_id)[0] || null
  );
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

function buildAttendanceKey(userId, targetDate) {
  return `${userId}:${targetDate}`;
}

function isResearchOwnedAttendanceRow(row) {
  return String(row?.notes || '').trim() === RESEARCH_TRIGGER_ATTENDANCE_NOTE;
}

function extractDateOnlyFromTimestamp(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function buildReplacementPlan({ selectedUsers, targetDate, snapshot }) {
  const selectedUserIds = new Set(selectedUsers.map((user) => user.userId));
  const targetDateAttendanceRows = (snapshot.existingAttendanceRows || []).filter(
    (row) => row.attendance_date === targetDate && selectedUserIds.has(row.user_id)
  );
  const replaceableAttendanceRows = targetDateAttendanceRows.filter(isResearchOwnedAttendanceRow);
  const unsafeAttendanceRows = targetDateAttendanceRows.filter(
    (row) => !isResearchOwnedAttendanceRow(row)
  );
  const replaceableUserIds = new Set(replaceableAttendanceRows.map((row) => row.user_id));
  const replaceableLocationEvents = (snapshot.existingLocationEvents || []).filter(
    (row) =>
      replaceableUserIds.has(row.user_id) &&
      extractDateOnlyFromTimestamp(row.event_timestamp) === targetDate
  );

  return {
    attendanceRows: replaceableAttendanceRows,
    unsafeAttendanceRows,
    replaceableUserIds: [...replaceableUserIds],
    locationEventRows: replaceableLocationEvents,
    attendance: replaceableAttendanceRows.length,
    location_events: replaceableLocationEvents.length
  };
}

function buildModeSummary(plannedAttendanceRows) {
  return {
    wfo: plannedAttendanceRows.filter((row) => row.category_id === ATTENDANCE_CATEGORY_IDS.WFO).length,
    wfh: plannedAttendanceRows.filter((row) => row.category_id === ATTENDANCE_CATEGORY_IDS.WFH).length,
    wfa: plannedAttendanceRows.filter((row) => row.category_id === ATTENDANCE_CATEGORY_IDS.WFA).length
  };
}

function buildDisciplineSummary(plannedAttendanceRows) {
  const summary = { ontime: 0, late: 0, early: 0, alpha: 0 };

  for (const row of plannedAttendanceRows) {
    if (Number(row.status_id) === ATTENDANCE_STATUS_IDS.LATE) {
      summary.late += 1;
      continue;
    }

    if (Number(row.status_id) === ATTENDANCE_STATUS_IDS.EARLY) {
      summary.early += 1;
      continue;
    }

    if (Number(row.status_id) === ATTENDANCE_STATUS_IDS.ALPHA) {
      summary.alpha += 1;
      continue;
    }

    summary.ontime += 1;
  }

  return summary;
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
  const targetCount =
    endpointType === 'full-day'
      ? eligibleUserCount
      : eligibleUserCount === 0
        ? 0
        : Math.min(eligibleUserCount, Math.max(1, Math.round(eligibleUserCount * DAILY_SUBSET_PERCENT)));

  const selectedUsers =
    endpointType === 'full-day'
      ? buildDeterministicOrder(eligibleUsers, `${seed}:full-day`, (userEntry) => userEntry.userId)
      : await selectDailyUsers({ eligibleUsers, targetCount, seed });

  const modeAssignments = assignModes(selectedUsers, seed);
  const disciplineAssignments = assignDisciplineStatuses(selectedUsers, seed, request.disciplineMix);
  const replacement =
    request.existingStrategy === 'replace'
      ? buildReplacementPlan({ selectedUsers, targetDate, snapshot })
      : {
          attendanceRows: [],
          unsafeAttendanceRows: [],
          replaceableUserIds: [],
          locationEventRows: [],
          attendance: 0,
          location_events: 0
        };
  const existingAttendanceKeys = new Set(
    (snapshot.existingAttendanceRows || []).map((row) => buildAttendanceKey(row.user_id, row.attendance_date))
  );
  const replaceableAttendanceKeys = new Set(
    replacement.attendanceRows.map((row) => buildAttendanceKey(row.user_id, row.attendance_date))
  );
  const unsafeAttendanceKeys = new Set(
    replacement.unsafeAttendanceRows.map((row) => buildAttendanceKey(row.user_id, row.attendance_date))
  );

  const plannedAttendanceRows = [];
  const plannedBookingRows = [];
  const plannedLocationEventRows = [];
  const conflicts = [];
  const warnings = [];
  let skippedExisting = 0;
  let skippedConflict = 0;
  let invalidReferenceCount = 0;

  if (request.existingStrategy === 'replace' && replacement.unsafeAttendanceRows.length > 0) {
    warnings.push(
      `existing_strategy=replace hanya mengganti attendance research-owned. ${replacement.unsafeAttendanceRows.length} row existing non-research tetap di-skip.`
    );
  }

  if (request.existingStrategy === 'replace' && replacement.location_events > 0) {
    warnings.push(REPLACE_LOCATION_EVENT_WARNING);
  }

  for (const selectedUser of selectedUsers) {
    const attendanceKey = buildAttendanceKey(selectedUser.userId, targetDate);
    if (existingAttendanceKeys.has(attendanceKey)) {
      if (request.existingStrategy === 'skip') {
        skippedExisting += 1;
        continue;
      }

      if (unsafeAttendanceKeys.has(attendanceKey)) {
        skippedExisting += 1;
        continue;
      }

      if (!replaceableAttendanceKeys.has(attendanceKey)) {
        skippedExisting += 1;
        continue;
      }
    }

    const modeName = modeAssignments.get(selectedUser.userId) || 'WFO';
    const disciplineName = disciplineAssignments.assignments.get(selectedUser.userId) || 'ontime';
    const timing = buildAttendanceTimingForDiscipline(
      disciplineName,
      targetDate,
      seed,
      selectedUser.userId
    );
    const expectedLocations = snapshot.expectedLocationsByUser?.[selectedUser.userId] || {};

    const attendanceRow = {
      user_id: selectedUser.userId,
      attendance_date: targetDate,
      category_id: timing.categoryId || ATTENDANCE_CATEGORY_IDS[modeName],
      status_id: timing.statusId,
      booking_id: null,
      location_id: null,
      time_in: timing.timeIn,
      time_out: timing.timeOut,
      work_hour: timing.workHour,
      notes: RESEARCH_TRIGGER_ATTENDANCE_NOTE
    };

    if (!timing.isPresent) {
      plannedAttendanceRows.push(attendanceRow);
      continue;
    }

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
          notes: RESEARCH_TRIGGER_BOOKING_NOTE
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
        event_timestamp: timing.eventTimestamps?.enter || attendanceRow.time_in
      },
      {
        user_id: selectedUser.userId,
        location_id: attendanceRow.location_id,
        event_type: 'EXIT',
        event_timestamp: timing.eventTimestamps?.exit || attendanceRow.time_out
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
      existing_strategy: request.existingStrategy,
      skip_existing: request.existingStrategy === 'skip',
      daily_subset_percent: endpointType === 'daily' ? 30 : undefined,
      seed_suffix: request.seedSuffix || null,
      discipline_mix: request.disciplineMix
    },
    population: {
      source: 'existing July 2025 attendance baseline',
      baseline_user_count: baselineUserCount,
      eligible_user_count: eligibleUserCount,
      selected_user_count: selectedUsers.length
    },
    selection_summary:
      endpointType === 'daily'
        ? {
            strategy: 'fixed-percentage',
            subset_percent: 30,
            target_user_ids: selectedUsers.map((selectedUser) => selectedUser.userId)
          }
        : {
            strategy: 'full-population',
            target_user_ids: selectedUsers.map((selectedUser) => selectedUser.userId)
          },
    mode_summary: buildModeSummary(plannedAttendanceRows),
    discipline_summary: buildDisciplineSummary(plannedAttendanceRows),
    warnings,
    conflicts,
    skipped_existing: skippedExisting,
    skipped_conflict: skippedConflict,
    invalid_reference_count: invalidReferenceCount,
    replacement,
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
  const { Attendance, LocationEvent, sequelize } = await import('../models/index.js');
  const transaction = await sequelize.transaction();

  try {
    const replacement = { attendance: 0, location_events: 0 };

    if (plan.replacement?.replaceableUserIds?.length) {
      const attendanceIdsToReplace = plan.replacement.attendanceRows
        .map((row) => row.id_attendance)
        .filter((value) => value !== undefined && value !== null);
      const replaceableUserIds = plan.replacement.replaceableUserIds;

      if (replaceableUserIds.length > 0) {
        replacement.location_events = await LocationEvent.destroy({
          where: {
            user_id: {
              [sequelize.Sequelize.Op.in]: replaceableUserIds
            },
            event_timestamp: {
              [sequelize.Sequelize.Op.gte]: `${plan.targetDate} 00:00:00`,
              [sequelize.Sequelize.Op.lt]: `${plan.targetDate} 23:59:59`
            }
          },
          transaction
        });
      }

      if (attendanceIdsToReplace.length > 0) {
        replacement.attendance = await Attendance.destroy({
          where: {
            id_attendance: {
              [sequelize.Sequelize.Op.in]: attendanceIdsToReplace
            }
          },
          transaction
        });
      }
    }

    const rawAppliedWrites = await applyResearchAttendancePlan({ plan, transaction });
    await transaction.commit();

    return {
      applied_writes: {
        attendance: rawAppliedWrites.attendance,
        bookings: rawAppliedWrites.bookings,
        location_events:
          rawAppliedWrites.location_events ?? rawAppliedWrites.locationEvents ?? 0
      },
      replaced: replacement
    };
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
    existing_strategy: request.existingStrategy,
    policy: plan.policy,
    population: plan.population,
    mode_summary: plan.mode_summary,
    discipline_summary: plan.discipline_summary,
    selection_summary: plan.selection_summary,
    warnings: plan.warnings,
    conflicts: plan.conflicts,
    planned_writes: {
      attendance: plan.plannedAttendanceRows.length,
      bookings: plan.plannedBookingRows.length,
      location_events: plan.plannedLocationEventRows.length
    },
    would_replace: {
      attendance: plan.replacement?.attendance || 0,
      location_events: plan.replacement?.location_events || 0
    },
    skipped_existing: plan.skipped_existing,
    skipped_conflict: plan.skipped_conflict
  };
}

function buildApplyResponse({ endpointType, request, plan, seed, appliedResult }) {
  return {
    success: true,
    endpoint_type: endpointType,
    mode: 'apply',
    target_date: request.targetDate,
    seed,
    existing_strategy: request.existingStrategy,
    policy: plan.policy,
    population: plan.population,
    mode_summary: plan.mode_summary,
    discipline_summary: plan.discipline_summary,
    selection_summary: plan.selection_summary,
    warnings: plan.warnings,
    conflicts: plan.conflicts,
    applied_writes: appliedResult.applied_writes,
    replaced: appliedResult.replaced,
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

  const seed = buildTriggerSeed(request, endpointType);
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
      409,
      'E_INVALID_REFERENCE_STATE',
      'Research attendance trigger memiliki conflict reference.',
      {
        target_date: request.targetDate,
        endpoint_type: endpointType,
        conflicts: plan.conflicts,
        hint: 'Jalankan dry_run=true atau siapkan approved WFA booking/lokasi untuk user conflict.'
      }
    );
  }

  const appliedResult = await applyPlan({
    endpointType,
    targetDate: request.targetDate,
    seed,
    request,
    snapshot,
    plan,
    user
  });
  return buildApplyResponse({ endpointType, request, plan, seed, appliedResult });
}

export { APPLY_CONFIRMATION, DEFAULT_DISCIPLINE_MIX, RESEARCH_TRIGGER_ATTENDANCE_NOTE };
