// Set timezone to Asia/Jakarta for consistent date/time handling
process.env.TZ = process.env.TZ || 'Asia/Jakarta';

import app from './app.js';
import config from './config/index.js';
import sequelize from './config/database.js';
import logger from './utils/logger.js';
import { ensureSchedulerStarted } from './utils/schedulerLifecycle.js';
import {
  getReadinessSnapshot,
  markDatabaseReady,
  markDatabaseUnready,
  markSchedulerUnready
} from './utils/readinessState.js';

(async () => {
  let databaseReady = false;

  try {
    await sequelize.authenticate();
    markDatabaseReady();
    databaseReady = true;
    logger.info('Database connected successfully');
  } catch (error) {
    markDatabaseUnready();
    markSchedulerUnready();
    logger.error('Database connection failed', {
      error: error.message,
      stack: error.stack
    });
    logger.warn('Server will start without database connection; readiness will remain failed.');
  }

  if (databaseReady) {
    logger.info('Fuzzy AHP Engine ready for intelligent features');

    try {
      await ensureSchedulerStarted({ source: 'startup' });
    } catch (schedulerError) {
      logger.warn('Server will start without scheduled jobs; readiness will remain failed.', {
        error: schedulerError.message,
        stack: schedulerError.stack
      });
    }
  }

  app.listen(config.port, () => {
    const readiness = getReadinessSnapshot();

    logger.info(`Server 🚀 on port ${config.port}`);
    if (readiness.ready) {
      logger.info('Startup dependencies are ready.');
    } else {
      logger.warn('Server started in degraded mode.', {
        components: readiness.components,
        missing: readiness.missing
      });
    }

    console.log(`🚀 Server running on port ${config.port}`);
    if (!readiness.ready) {
      console.warn(`⚠️ Startup readiness failed: ${readiness.missing.join(', ')}`);
    }
    console.log(`📚 API Documentation: http://localhost:${config.port}/docs`);
  });
})();
