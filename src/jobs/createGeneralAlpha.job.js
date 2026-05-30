import cron from 'node-cron';
import { Op } from 'sequelize';
import Holidays from 'date-holidays';

import sequelize from '../config/database.js';
import { User, Role, Attendance, Booking } from '../models/index.js';
import logger from '../utils/logger.js';
import { executeJobWithTimeout } from '../utils/jobHelper.js';

const buildGeneralAlphaRows = (userIds, targetDate, stampedDateTime, notes) => {
  return userIds.map((userId) => ({
    user_id: userId,
    attendance_date: targetDate,
    status_id: 3,
    category_id: 1,
    location_id: null,
    booking_id: null,
    time_in: stampedDateTime,
    time_out: stampedDateTime,
    work_hour: 0,
    notes,
    created_at: stampedDateTime,
    updated_at: stampedDateTime
  }));
};

const countRequiredUsersExcludedByWfa = (requiredUserIds, wfaUserIdSet) => {
  const uniqueRequiredUserIds = new Set(requiredUserIds);
  let skipped = 0;

  uniqueRequiredUserIds.forEach((userId) => {
    if (wfaUserIdSet.has(userId)) {
      skipped += 1;
    }
  });

  return skipped;
};

const createMissingGeneralAlphaRows = async ({
  candidateUserIds,
  targetDate,
  stampedDateTime,
  notes
}) => {
  if (candidateUserIds.length === 0) {
    return { created: 0, skipped: 0, insertRowsRequested: 0 };
  }

  return sequelize.transaction(async (transaction) => {
    const existingAttendances = await Attendance.findAll({
      attributes: ['user_id'],
      where: {
        user_id: { [Op.in]: candidateUserIds },
        attendance_date: targetDate
      },
      transaction
    });

    const existingUserIds = new Set(existingAttendances.map((attendance) => attendance.user_id));
    const missingUserIds = candidateUserIds.filter((userId) => !existingUserIds.has(userId));
    const skipped = candidateUserIds.length - missingUserIds.length;

    if (missingUserIds.length === 0) {
      return { created: 0, skipped, insertRowsRequested: 0 };
    }

    const rows = buildGeneralAlphaRows(missingUserIds, targetDate, stampedDateTime, notes);
    const insertedRows = await Attendance.bulkCreate(rows, { ignoreDuplicates: true, transaction });
    const created = Array.isArray(insertedRows) ? insertedRows.length : 0;

    return { created, skipped, insertRowsRequested: rows.length };
  });
};

/**
 * Main function to create general alpha records for users who didn't check-in
 * This runs on working days and excludes Admin and Management roles
 */
const createGeneralAlphaRecords = async () => {
  try {
    logger.info('Starting create general alpha records job...');

    // Get current Jakarta time for today's date - FIXED TIMEZONE
    const now = new Date();

    // Use proper timezone conversion instead of manual offset
    const jakartaTimeString = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
    const jakartaTime = new Date(jakartaTimeString);
    const todayDate = jakartaTime.toISOString().split('T')[0]; // YYYY-MM-DD format

    logger.info(
      `Timezone debug - UTC: ${now.toISOString()}, Jakarta: ${jakartaTime.toISOString()}, Date: ${todayDate}`
    );

    // Determine yesterday (H-1) as target date for GENERAL alpha marking
    const target = new Date(jakartaTime);
    target.setDate(target.getDate() - 1);
    const targetDate = target.toISOString().split('T')[0];

    // Skip if target date is weekend or holiday (GENERAL alpha only runs on working days)
    const hd = new Holidays('ID');
    const isHoliday = hd.isHoliday(target);
    const dayOfWeek = target.getDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (isWeekend || isHoliday) {
      logger.info(
        `Skipping GENERAL alpha - target ${targetDate} is ${isWeekend ? 'weekend' : 'holiday'}`
      );
      return;
    }

    logger.info(`Processing GENERAL alpha records for working day: ${targetDate}`);

    // STEP A: Get all users who are required to attend (excluding Admin and Management)
    const requiredUsers = await User.findAll({
      attributes: ['id_users'],
      include: [
        {
          model: Role,
          as: 'role',
          where: {
            role_name: {
              [Op.notIn]: ['Admin', 'Management']
            }
          }
        }
      ],
      where: { deleted_at: null }
    });

    const requiredUserIds = requiredUsers.map((u) => u.id_users);

    if (requiredUserIds.length === 0) {
      logger.info('No users found that require attendance tracking');
      return;
    }

    logger.info(`Found ${requiredUserIds.length} users who are required to attend`);

    // STEP B: Users who have approved WFA bookings for targetDate (exclude from GENERAL alpha)
    const wfaUsers = await Booking.findAll({
      attributes: ['user_id'],
      where: {
        schedule_date: targetDate,
        status: 1 // approved status
      }
    });
    const wfaUserIds = wfaUsers.map((b) => b.user_id);
    const wfaUserIdSet = new Set(wfaUserIds);
    const wfaSkipped = countRequiredUsersExcludedByWfa(requiredUserIds, wfaUserIdSet);

    logger.info(
      `Users with approved WFA bookings: ${wfaUserIds.length}; required users excluded by WFA: ${wfaSkipped}`
    );

    // STEP C (GENERAL): Required users who do not have approved WFA booking.
    // Existing attendance is checked inside the transactional batch insert helper.
    const alphaUserIds = requiredUserIds.filter((userId) => !wfaUserIdSet.has(userId));

    if (alphaUserIds.length === 0) {
      logger.info('No users need alpha records - all required users have approved WFA');
      return;
    }

    logger.info(`Found ${alphaUserIds.length} users who need alpha eligibility check`);

    // Calculate execution timestamp once (WIB) on target date
    // Reuse current time for stamping
    const nowForStamp = new Date();
    const jakartaTimeStringForStamp = nowForStamp.toLocaleString('en-US', {
      timeZone: 'Asia/Jakarta'
    });
    const jakartaTimeForStamp = new Date(jakartaTimeStringForStamp);
    const hh = String(jakartaTimeForStamp.getHours()).padStart(2, '0');
    const mm = String(jakartaTimeForStamp.getMinutes()).padStart(2, '0');
    const ss = String(jakartaTimeForStamp.getSeconds()).padStart(2, '0');
    const stampedDateTime = new Date(`${targetDate}T${hh}:${mm}:${ss}+07:00`);

    const { created, skipped, insertRowsRequested } = await createMissingGeneralAlphaRows({
      candidateUserIds: alphaUserIds,
      targetDate,
      stampedDateTime,
      notes: 'Auto alpha (working day, no attendance record)'
    });

    logger.info(
      `Create general alpha records job completed. Alpha records created: ${created}, insert rows requested: ${insertRowsRequested}, skipped: ${skipped + wfaSkipped}`
    );
  } catch (error) {
    logger.error('Error in create general alpha records job:', error.message, {
      stack: error.stack
    });
    throw error;
  }
};

/**
 * Initialize and start the cron job for creating general alpha records
 * Runs on working days (Monday-Friday) at 23:45 Jakarta time
 */
export const startCreateGeneralAlphaJob = () => {
  logger.info('Create General Alpha job scheduled to run on working days at 23:55');

  // Schedule cron job to run Monday-Friday at 23:55 Jakarta time
  const task = cron.schedule(
    '55 23 * * 1-5',
    async () => {
      try {
        await executeJobWithTimeout(
          'CreateGeneralAlpha',
          createGeneralAlphaRecords,
          5 * 60 * 1000 // 5 min timeout
        );
      } catch (error) {
        logger.error('Create General Alpha failed:', error);
      }
    },
    {
      scheduled: true,
      timezone: 'Asia/Jakarta'
    }
  );

  logger.info('Create General Alpha cron job has been initialized');

  return task;
};

/**
 * Manual trigger function for testing purposes
 */
export const triggerCreateGeneralAlpha = async () => {
  logger.info('Manual trigger: Create general alpha records job');
  await createGeneralAlphaRecords();
  return {
    success: true,
    message: 'General alpha records creation completed',
    timestamp: new Date().toISOString()
  };
};

/**
 * Run GENERAL alpha for a specific target date (YYYY-MM-DD) - testing/ops helper
 */
export const runGeneralAlphaForDate = async (targetDate) => {
  try {
    logger.info(`Running GENERAL alpha for target date: ${targetDate}`);

    // Build target Date in Jakarta timezone for weekend/holiday evaluation
    const base = new Date(`${targetDate}T00:00:00.000Z`);
    const hd = new Holidays('ID');
    const jakartaTimeString = base.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
    const targetJakarta = new Date(jakartaTimeString);
    const isHoliday = hd.isHoliday(targetJakarta);
    const dayOfWeek = targetJakarta.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    if (isWeekend || isHoliday) {
      logger.info(
        `Skipping GENERAL alpha (override) - target ${targetDate} is ${isWeekend ? 'weekend' : 'holiday'}`
      );
      return { created: 0, skipped: 0, insertRowsRequested: 0 };
    }

    // STEP A: Users excluding Admin/Management
    const requiredUsers = await User.findAll({
      attributes: ['id_users'],
      include: [
        {
          model: Role,
          as: 'role',
          where: { role_name: { [Op.notIn]: ['Admin', 'Management'] } }
        }
      ],
      where: { deleted_at: null }
    });
    const requiredUserIds = requiredUsers.map((u) => u.id_users);

    // STEP B: Users with approved WFA bookings on target date (excluded from GENERAL)
    const wfaUsers = await Booking.findAll({
      attributes: ['user_id'],
      where: { schedule_date: targetDate, status: 1 }
    });
    const wfaUserIds = wfaUsers.map((b) => b.user_id);
    const wfaUserIdSet = new Set(wfaUserIds);
    const wfaSkipped = countRequiredUsersExcludedByWfa(requiredUserIds, wfaUserIdSet);

    // Determine GENERAL alpha candidates. Existing attendance is checked transactionally later.
    const alphaUserIds = requiredUserIds.filter((uid) => !wfaUserIdSet.has(uid));

    if (alphaUserIds.length === 0) {
      logger.info('GENERAL alpha override: No candidates');
      return { created: 0, skipped: wfaSkipped, insertRowsRequested: 0 };
    }

    // Execution time in Jakarta for stamping on target date
    const currentTime = new Date();
    const currentJakartaTimeString = currentTime.toLocaleString('en-US', {
      timeZone: 'Asia/Jakarta'
    });
    const currentJakartaTime = new Date(currentJakartaTimeString);
    const hh = String(currentJakartaTime.getHours()).padStart(2, '0');
    const mm = String(currentJakartaTime.getMinutes()).padStart(2, '0');
    const ss = String(currentJakartaTime.getSeconds()).padStart(2, '0');
    const stampedDateTime = new Date(`${targetDate}T${hh}:${mm}:${ss}+07:00`);

    const result = await createMissingGeneralAlphaRows({
      candidateUserIds: alphaUserIds,
      targetDate,
      stampedDateTime,
      notes: 'Auto alpha (override run - working day, no attendance)'
    });
    const skipped = result.skipped + wfaSkipped;

    logger.info(
      `GENERAL alpha override completed for ${targetDate}. created=${result.created}, insertRowsRequested=${result.insertRowsRequested}, skipped=${skipped}`
    );
    return { created: result.created, skipped, insertRowsRequested: result.insertRowsRequested };
  } catch (error) {
    logger.error('runGeneralAlphaForDate failed:', error.message, {
      stack: error.stack
    });
    throw error;
  }
};
