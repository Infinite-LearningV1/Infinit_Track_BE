import cron from 'node-cron';
import { Op } from 'sequelize';

import sequelize from '../config/database.js';
import { Booking, Attendance } from '../models/index.js';
import logger from '../utils/logger.js';
import { executeJobWithTimeout } from '../utils/jobHelper.js';

/**
 * Resolve unused WFA bookings and expired pending bookings
 * Task A: Create alpha records for unused approved WFA bookings
 * Task B: Reject expired pending bookings
 */
export const resolveWfaBookingsJob = async () => {
  try {
    logger.info('Starting resolve WFA bookings job...');

    // Get current Jakarta time properly
    const now = new Date();
    const jakartaTimeString = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
    const jakartaTime = new Date(jakartaTimeString);

    // Compute target date H-1 (yesterday) in Jakarta timezone
    const yesterday = new Date(jakartaTime);
    yesterday.setDate(jakartaTime.getDate() - 1);
    const targetDate = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD format

    logger.info(`Processing WFA bookings for date (H-1): ${targetDate}`);

    await runResolverTasks(targetDate, jakartaTime);

    logger.info('Resolve WFA bookings job completed successfully');
  } catch (error) {
    logger.error('Error in resolve WFA bookings job:', error);
    throw error;
  }
};

/**
 * Run WFA bookings resolver for a specific target date (YYYY-MM-DD)
 */
export const resolveWfaBookingsForDate = async (targetDate) => {
  try {
    // Get current Jakarta time properly
    const now = new Date();
    const jakartaTimeString = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
    const jakartaTime = new Date(jakartaTimeString);

    logger.info(`Resolve WFA bookings for explicit date: ${targetDate}`);
    await runResolverTasks(targetDate, jakartaTime);
    return { success: true, targetDate };
  } catch (error) {
    logger.error('Error in resolveWfaBookingsForDate:', error);
    return { success: false, error: error.message };
  }
};

const runResolverTasks = async (targetDate, jakartaTime) => {
  let taskAFailure;
  let taskBFailure;

  try {
    // TASK A: Handle unused approved WFA bookings for targetDate (H-1)
    await handleUnusedApprovedBookings(targetDate, jakartaTime);
  } catch (error) {
    taskAFailure = error;
  }

  try {
    // TASK B: Handle expired pending bookings even if Task A failed
    await handleExpiredPendingBookings(targetDate);
  } catch (error) {
    taskBFailure = error;
  }

  if (taskAFailure && taskBFailure) {
    throw new AggregateError(
      [taskAFailure, taskBFailure],
      `Resolver tasks failed. Task A: ${taskAFailure.message}; Task B: ${taskBFailure.message}`
    );
  }

  if (taskAFailure) {
    throw taskAFailure;
  }

  if (taskBFailure) {
    throw taskBFailure;
  }
};

const buildUnusedWfaAlphaRows = (bookings, todayDate, stampedDateTime) => {
  return bookings.map((booking) => ({
    user_id: booking.user_id,
    category_id: 3,
    status_id: 3,
    location_id: booking.location_id,
    booking_id: booking.booking_id,
    time_in: stampedDateTime,
    time_out: stampedDateTime,
    work_hour: 0,
    attendance_date: booking.schedule_date || todayDate,
    notes: `Booking WFA (ID: ${booking.booking_id}) disetujui tetapi tidak digunakan.`,
    created_at: stampedDateTime,
    updated_at: stampedDateTime
  }));
};

/**
 * Task A: Create alpha records for approved WFA bookings that weren't used
 */
const handleUnusedApprovedBookings = async (todayDate, jakartaTime) => {
  try {
    logger.info('Task A: Processing unused approved WFA bookings...');

    // Find all approved WFA bookings for today
    const approvedBookings = await Booking.findAll({
      where: {
        schedule_date: todayDate,
        status: 1 // approved status
      }
    });

    logger.info(`Found ${approvedBookings.length} approved WFA bookings for today`);

    // Build execution time (HH:mm:ss) in Jakarta, then stamp to target date
    const hh = String(jakartaTime.getHours()).padStart(2, '0');
    const mm = String(jakartaTime.getMinutes()).padStart(2, '0');
    const ss = String(jakartaTime.getSeconds()).padStart(2, '0');
    const stampedDateTime = new Date(`${todayDate}T${hh}:${mm}:${ss}+07:00`);

    const result = approvedBookings.length
      ? await sequelize.transaction(async (transaction) => {
          const userIds = [...new Set(approvedBookings.map((booking) => booking.user_id))];
          const existingAttendances = await Attendance.findAll({
            attributes: ['user_id'],
            where: {
              user_id: { [Op.in]: userIds },
              attendance_date: todayDate
            },
            transaction
          });

          const existingUserIds = new Set(existingAttendances.map((attendance) => attendance.user_id));
          const bookingsToInsert = approvedBookings.filter(
            (booking) => !existingUserIds.has(booking.user_id)
          );
          const skippedBookings = approvedBookings.length - bookingsToInsert.length;

          if (bookingsToInsert.length === 0) {
            return { created: null, skipped: skippedBookings, insertRowsRequested: 0 };
          }

          const rows = buildUnusedWfaAlphaRows(bookingsToInsert, todayDate, stampedDateTime);
          await Attendance.bulkCreate(rows, { ignoreDuplicates: true, transaction });
          return { created: null, skipped: skippedBookings, insertRowsRequested: rows.length };
        })
      : { created: null, skipped: 0, insertRowsRequested: 0 };

    logger.info(
      `Task A completed. Alpha insert rows requested: ${result.insertRowsRequested}, Pre-insert skipped: ${result.skipped}. Actual created count unavailable with ignoreDuplicates.`
    );
  } catch (error) {
    logger.error('Error in Task A (unused approved bookings):', error);
    throw error;
  }
};

/**
 * Task B: Reject expired pending bookings
 */
const handleExpiredPendingBookings = async (todayDate) => {
  logger.info('Task B: Processing expired pending bookings...');

  let expiredBookings;
  try {
    // Find all pending bookings with schedule_date < today
    expiredBookings = await Booking.findAll({
      where: {
        schedule_date: {
          [Op.lt]: todayDate
        },
        status: 3 // pending status
      }
    });
  } catch (error) {
    logger.error('Error finding expired pending bookings in Task B:', error);
    throw error;
  }

  logger.info(`Found ${expiredBookings.length} expired pending bookings`);

  let rejectedBookings = 0;
  const updateFailures = [];

  // Get proper timestamp for updates
  const updateTime = new Date();

  // Process each expired booking
  for (const booking of expiredBookings) {
    try {
      await booking.update({
        status: 2, // rejected
        processed_at: updateTime,
        approved_by: null, // System rejection, no specific admin
        updated_at: updateTime
      });

      rejectedBookings++;
      logger.info(
        `Rejected expired booking ID: ${booking.booking_id}, schedule_date: ${booking.schedule_date}`
      );
    } catch (error) {
      updateFailures.push({ bookingId: booking.booking_id, error });
      logger.error(`Error rejecting booking ID: ${booking.booking_id} - ${error.message}`);
    }
  }

  logger.info(
    `Task B completed. Expired bookings rejected: ${rejectedBookings}, Errors: ${updateFailures.length}`
  );

  if (updateFailures.length > 0) {
    const failureMessage = `Failed to reject ${updateFailures.length} expired pending WFA booking${
      updateFailures.length === 1 ? '' : 's'
    }`;
    logger.error(`${failureMessage}. Booking IDs: ${updateFailures.map(({ bookingId }) => bookingId).join(', ')}`);
    throw new AggregateError(
      updateFailures.map(({ error }) => error),
      failureMessage
    );
  }
};

/**
 * Start the cron job for resolving WFA bookings
 * Runs daily at 23:50 Jakarta time
 */
export const startResolveWfaBookingsJob = () => {
  logger.info('Resolve WFA Bookings job scheduled to run daily at 23:50');

  // Schedule cron job to run daily at 23:50 Jakarta time
  const task = cron.schedule(
    '50 23 * * *',
    async () => {
      try {
        await executeJobWithTimeout(
          'ResolveWfaBookings',
          resolveWfaBookingsJob,
          5 * 60 * 1000 // 5 min timeout
        );
      } catch (error) {
        logger.error('Resolve WFA Bookings failed:', error);
      }
    },
    {
      scheduled: true,
      timezone: 'Asia/Jakarta'
    }
  );

  logger.info('Resolve WFA Bookings cron job has been initialized');

  return task;
};

/**
 * Manual trigger function for testing purposes
 * This function can be called manually to test the resolve logic
 */
export const triggerResolveWfaBookings = async () => {
  logger.info('Manual trigger: Resolve WFA bookings job');
  await resolveWfaBookingsJob();
  return {
    success: true,
    message: 'Resolve WFA bookings job executed manually',
    timestamp: new Date().toISOString()
  };
};
