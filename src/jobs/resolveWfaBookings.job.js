import cron from 'node-cron';
import { Op } from 'sequelize';

import { Booking, Attendance } from '../models/index.js';
import logger from '../utils/logger.js';
import { executeJobWithTimeout } from '../utils/jobHelper.js';
import { isAttendanceDuplicateConstraintError } from '../utils/attendanceDuplicateError.js';

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

    // TASK A: Handle unused approved WFA bookings for targetDate (H-1)
    await handleUnusedApprovedBookings(targetDate, jakartaTime);

    // TASK B: Handle expired pending bookings
    await handleExpiredPendingBookings(targetDate, jakartaTime);

    logger.info('Resolve WFA bookings job completed successfully');
  } catch (error) {
    logger.error('Error in resolve WFA bookings job:', error);
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
    const alphaResult = await handleUnusedApprovedBookings(targetDate, jakartaTime);
    const expiredResult = await handleExpiredPendingBookings(targetDate, jakartaTime);
    return {
      success: true,
      targetDate,
      mutations: {
        createdAlpha: alphaResult.createdAlpha,
        rejectedExpired: expiredResult.rejectedExpired
      }
    };
  } catch (error) {
    logger.error('Error in resolveWfaBookingsForDate:', error);
    return { success: false, error: error.message };
  }
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

    let alphaRecordsCreated = 0;
    let skippedBookings = 0;

    // Build execution time (HH:mm:ss) in Jakarta, then stamp to target date
    const hh = String(jakartaTime.getHours()).padStart(2, '0');
    const mm = String(jakartaTime.getMinutes()).padStart(2, '0');
    const ss = String(jakartaTime.getSeconds()).padStart(2, '0');
    const stampedDateTime = new Date(`${todayDate}T${hh}:${mm}:${ss}+07:00`);

    // Process each approved booking
    for (const booking of approvedBookings) {
      try {
        // Check if user has ANY attendance record for today (not just for this booking)
        const existingAttendance = await Attendance.findOne({
          where: {
            user_id: booking.user_id,
            attendance_date: todayDate
          }
        });

        if (!existingAttendance) {
          // No attendance record found for this user today, create alpha record
          await Attendance.create({
            user_id: booking.user_id,
            category_id: 3, // Work From Anywhere
            status_id: 3, // alpha status
            location_id: booking.location_id,
            booking_id: booking.booking_id,
            time_in: stampedDateTime,
            time_out: stampedDateTime,
            work_hour: 0,
            attendance_date: booking.schedule_date,
            notes: `Booking WFA (ID: ${booking.booking_id}) disetujui tetapi tidak digunakan.`,
            created_at: stampedDateTime,
            updated_at: stampedDateTime
          });

          alphaRecordsCreated++;
          logger.info(
            `Created alpha attendance record for unused booking ID: ${booking.booking_id}, user ID: ${booking.user_id}`
          );
        } else {
          // Attendance record already exists, skip
          skippedBookings++;
          logger.debug(
            `Skipping booking ID: ${booking.booking_id} - user already has attendance record`
          );
        }
      } catch (error) {
        if (isAttendanceDuplicateConstraintError(error)) {
          skippedBookings++;
          logger.info(
            `Duplicate-safe skip for booking ID: ${booking.booking_id}, user ID: ${booking.user_id}`
          );
          continue;
        }

        logger.error(`Error processing booking ID: ${booking.booking_id} - ${error.message}`);
      }
    }

    logger.info(
      `Task A completed. Alpha records created: ${alphaRecordsCreated}, Skipped: ${skippedBookings}`
    );
    return {
      createdAlpha: alphaRecordsCreated,
      skippedAlreadyFinal: skippedBookings
    };
  } catch (error) {
    logger.error('Error in Task A (unused approved bookings):', error);
    return {
      createdAlpha: 0,
      skippedAlreadyFinal: 0,
      error: error.message
    };
  }
};

/**
 * Task B: Reject expired pending bookings
 */
const handleExpiredPendingBookings = async (todayDate, _jakartaTime) => {
  try {
    logger.info('Task B: Processing expired pending bookings...');

    // Find all pending bookings with schedule_date < today
    const expiredBookings = await Booking.findAll({
      where: {
        schedule_date: {
          [Op.lt]: todayDate
        },
        status: 3 // pending status
      }
    });

    logger.info(`Found ${expiredBookings.length} expired pending bookings`);

    let rejectedBookings = 0;
    let errorCount = 0;

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
        errorCount++;
        logger.error(`Error rejecting booking ID: ${booking.booking_id} - ${error.message}`);
      }
    }

    logger.info(
      `Task B completed. Expired bookings rejected: ${rejectedBookings}, Errors: ${errorCount}`
    );
    return {
      rejectedExpired: rejectedBookings,
      errorCount
    };
  } catch (error) {
    logger.error('Error in Task B (expired pending bookings):', error);
    return {
      rejectedExpired: 0,
      errorCount: 1,
      error: error.message
    };
  }
};

/**
 * Start the cron job for resolving WFA bookings
 * Runs daily at 23:50 Jakarta time
 */
export const startResolveWfaBookingsJob = () => {
  logger.info('Resolve WFA Bookings job scheduled to run daily at 23:50');

  // Schedule cron job to run daily at 23:50 Jakarta time
  cron.schedule(
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
