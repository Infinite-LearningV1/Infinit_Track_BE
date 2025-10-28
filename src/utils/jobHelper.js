import logger from './logger.js';

/**
 * Job execution wrapper with timing and timeout
 * @param {string} jobName - Name of the job for logging
 * @param {Function} jobFunction - Async function to execute
 * @param {number} timeoutMs - Timeout in milliseconds (default: 5 minutes)
 * @returns {Promise<any>} Result from job function
 */
export async function executeJobWithTimeout(jobName, jobFunction, timeoutMs = 5 * 60 * 1000) {
  const startTime = Date.now();
  logger.info(`[${jobName}] Job started at ${new Date().toISOString()}`);

  let timeoutId;
  let isTimedOut = false;

  try {
    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        isTimedOut = true;
        reject(
          new Error(
            `Job '${jobName}' exceeded timeout of ${timeoutMs / 1000} seconds and was terminated`
          )
        );
      }, timeoutMs);
    });

    // Race between job execution and timeout
    const result = await Promise.race([jobFunction(), timeoutPromise]);

    // Clear timeout if job completed successfully
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    const durationSeconds = (duration / 1000).toFixed(2);

    logger.info(
      `[${jobName}] Job completed successfully at ${new Date().toISOString()} (Duration: ${durationSeconds}s)`
    );

    return result;
  } catch (error) {
    // Clear timeout on error
    if (timeoutId && !isTimedOut) {
      clearTimeout(timeoutId);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    const durationSeconds = (duration / 1000).toFixed(2);

    if (isTimedOut) {
      logger.error(
        `[${jobName}] Job TIMEOUT after ${durationSeconds}s - exceeded ${timeoutMs / 1000}s limit`,
        {
          jobName,
          duration: durationSeconds,
          timeout: timeoutMs / 1000,
          error: error.message
        }
      );
    } else {
      logger.error(`[${jobName}] Job failed after ${durationSeconds}s`, {
        jobName,
        duration: durationSeconds,
        error: error.message,
        stack: error.stack
      });
    }

    throw error;
  }
}

/**
 * Batch process records from database
 * @param {Object} model - Sequelize model
 * @param {Object} queryOptions - Query options (where, include, etc.)
 * @param {Function} processBatch - Async function to process each batch
 * @param {number} batchSize - Number of records per batch (default: 100)
 * @returns {Promise<{totalProcessed: number, totalBatches: number}>}
 */
export async function processBatchRecords(model, queryOptions, processBatch, batchSize = 100) {
  let offset = 0;
  let totalProcessed = 0;
  let batchNumber = 0;
  let hasMore = true;

  logger.info(`Starting batch processing with batch size: ${batchSize}`);

  while (hasMore) {
    batchNumber++;
    const batchStartTime = Date.now();

    // Fetch batch
    const records = await model.findAll({
      ...queryOptions,
      limit: batchSize,
      offset: offset
    });

    if (records.length === 0) {
      hasMore = false;
      break;
    }

    logger.info(`Processing batch ${batchNumber}: ${records.length} records (offset: ${offset})`);

    // Process batch
    try {
      const result = await processBatch(records, batchNumber);
      totalProcessed += records.length;

      const batchDuration = Date.now() - batchStartTime;
      logger.info(
        `Batch ${batchNumber} completed in ${batchDuration}ms (${records.length} records processed)`,
        result
      );
    } catch (error) {
      logger.error(`Error processing batch ${batchNumber}:`, {
        batchNumber,
        recordCount: records.length,
        error: error.message
      });
      // Continue with next batch even if current batch fails
    }

    // Move to next batch
    offset += batchSize;

    // Check if we got fewer records than batch size (last batch)
    if (records.length < batchSize) {
      hasMore = false;
    }
  }

  logger.info(
    `Batch processing completed: ${totalProcessed} total records processed in ${batchNumber} batches`
  );

  return {
    totalProcessed,
    totalBatches: batchNumber
  };
}

/**
 * Create a timing logger for manual timing
 * @param {string} operationName - Name of the operation
 * @returns {Object} Object with start() and end() methods
 */
export function createTimer(operationName) {
  let startTime;

  return {
    start: () => {
      startTime = Date.now();
      logger.info(`[TIMER] ${operationName} started`);
    },
    end: () => {
      if (!startTime) {
        logger.warn(`[TIMER] ${operationName} - start() was never called`);
        return 0;
      }
      const duration = Date.now() - startTime;
      const durationSeconds = (duration / 1000).toFixed(2);
      logger.info(`[TIMER] ${operationName} completed in ${durationSeconds}s`);
      return duration;
    },
    lap: (lapName) => {
      if (!startTime) {
        logger.warn(`[TIMER] ${operationName} - start() was never called`);
        return 0;
      }
      const duration = Date.now() - startTime;
      const durationSeconds = (duration / 1000).toFixed(2);
      logger.info(`[TIMER] ${operationName} - ${lapName}: ${durationSeconds}s`);
      return duration;
    }
  };
}
