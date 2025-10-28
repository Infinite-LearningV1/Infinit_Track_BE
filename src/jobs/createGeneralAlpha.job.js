import cron from 'node-cron';
import { Op } from 'sequelize';
import Holidays from 'date-holidays';

import { User, Role, Attendance, Booking } from '../models/index.js';
import logger from '../utils/logger.js';
import { executeJobWithTimeout } from '../utils/jobHelper.js';

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

    // STEP B: Get users who already have attendance for targetDate

    // B1: Users who already checked in (have attendance record)
    const presentUsers = await Attendance.findAll({
      attributes: ['user_id'],
      where: {
        attendance_date: targetDate
      }
    });
    const presentUserIds = presentUsers.map((a) => a.user_id);

    // B2: Users who have approved WFA bookings for targetDate (exclude from GENERAL alpha)
    const wfaUsers = await Booking.findAll({
      attributes: ['user_id'],
      where: {
        schedule_date: targetDate,
        status: 1 // approved status
      }
    });
    const wfaUserIds = wfaUsers.map((b) => b.user_id);

    // B3: Combine both lists into unique set
    const presentOrWfaUserIds = [...new Set([...presentUserIds, ...wfaUserIds])];

    logger.info(
      `Users with existing records: ${presentOrWfaUserIds.length} (${presentUserIds.length} checked-in, ${wfaUserIds.length} approved WFA)`
    );

    // STEP C (GENERAL): Determine who should get alpha status
    // Required users who have no attendance AND do not have approved WFA booking
    const alphaUserIds = requiredUserIds.filter(
      (userId) => !presentUserIds.includes(userId) && !wfaUserIds.includes(userId)
    );

    if (alphaUserIds.length === 0) {
      logger.info(
        'No users need alpha records - all required users have attendance or approved WFA'
      );
      return;
    }

    logger.info(`Found ${alphaUserIds.length} users who need alpha records`);

    // STEP D: Create alpha records
    let alphaRecordsCreated = 0;
    let errorCount = 0;

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

    for (const userId of alphaUserIds) {
      try {
        // Double-check that user doesn't already have an attendance record
        const existingRecord = await Attendance.findOne({
          where: {
            user_id: userId,
            attendance_date: targetDate
          }
        });

        if (!existingRecord) {
          await Attendance.create({
            user_id: userId,
            attendance_date: targetDate,
            status_id: 3, // Alpha
            category_id: 1, // WFO as default for GENERAL alpha
            location_id: null,
            booking_id: null,
            time_in: stampedDateTime, // WIB execution time on target date
            time_out: stampedDateTime,
            work_hour: 0,
            notes: 'Auto alpha (working day, no attendance record)',
            created_at: stampedDateTime,
            updated_at: stampedDateTime
          });

          alphaRecordsCreated++;
          logger.info(`Created alpha record for user ID: ${userId}`);
        } else {
          logger.debug(`Skipping user ID: ${userId} - attendance record already exists`);
        }
      } catch (error) {
        errorCount++;
        logger.error(`Error creating alpha record for user ID: ${userId} - ${error.message}`);
      }
    }

    logger.info(
      `Create general alpha records job completed. Alpha records created: ${alphaRecordsCreated}, Errors: ${errorCount}`
    );
  } catch (error) {
    logger.error('Error in create general alpha records job:', error.message, {
      stack: error.stack
    });
  }
};

/**
 * Initialize and start the cron job for creating general alpha records
 * Runs on working days (Monday-Friday) at 23:45 Jakarta time
 */
export const startCreateGeneralAlphaJob = () => {
  logger.info('Create General Alpha job scheduled to run on working days at 23:55');

  // Schedule cron job to run Monday-Friday at 23:55 Jakarta time
  cron.schedule(
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
      return { created: 0, skipped: 0 };
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

    // STEP B: Present users on target date
    const presentUsers = await Attendance.findAll({
      attributes: ['user_id'],
      where: { attendance_date: targetDate }
    });
    const presentUserIds = presentUsers.map((a) => a.user_id);

    // STEP C: Users with approved WFA bookings on target date (excluded from GENERAL)
    const wfaUsers = await Booking.findAll({
      attributes: ['user_id'],
      where: { schedule_date: targetDate, status: 1 }
    });
    const wfaUserIds = wfaUsers.map((b) => b.user_id);

    // Determine GENERAL alpha candidates
    const alphaUserIds = requiredUserIds.filter(
      (uid) => !presentUserIds.includes(uid) && !wfaUserIds.includes(uid)
    );

    if (alphaUserIds.length === 0) {
      logger.info('GENERAL alpha override: No candidates');
      return { created: 0, skipped: 0 };
    }

    let created = 0;
    let skipped = 0;

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

    for (const userId of alphaUserIds) {
      try {
        const exists = await Attendance.findOne({
          where: { user_id: userId, attendance_date: targetDate }
        });
        if (exists) {
          skipped++;
          continue;
        }
        await Attendance.create({
          user_id: userId,
          attendance_date: targetDate,
          status_id: 3,
          category_id: 1,
          location_id: null,
          booking_id: null,
          time_in: stampedDateTime,
          time_out: stampedDateTime,
          work_hour: 0,
          notes: 'Auto alpha (override run - working day, no attendance)',
          created_at: stampedDateTime,
          updated_at: stampedDateTime
        });
        created++;
      } catch (e) {
        logger.error(`GENERAL alpha override failed for user ${userId}: ${e.message}`);
      }
    }

    logger.info(
      `GENERAL alpha override completed for ${targetDate}. created=${created}, skipped=${skipped}`
    );
    return { created, skipped };
  } catch (error) {
    logger.error('runGeneralAlphaForDate failed:', error);
    return { created: 0, skipped: 0, error: error.message };
  }
};
