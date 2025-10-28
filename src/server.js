// Set timezone to Asia/Jakarta for consistent date/time handling
process.env.TZ = process.env.TZ || 'Asia/Jakarta';

import app from './app.js';
import config from './config/index.js';
import sequelize from './config/database.js';
import logger from './utils/logger.js';
import { startCreateGeneralAlphaJob } from './jobs/createGeneralAlpha.job.js';
import { startResolveWfaBookingsJob } from './jobs/resolveWfaBookings.job.js';
import { startAutoCheckoutJob } from './jobs/autoCheckout.job.js';

(async () => {
  try {
    await sequelize.authenticate();
    logger.info('Database connected successfully');

    // All smart features are now centralized in fuzzyAhpEngine.js
    logger.info('Fuzzy AHP Engine ready for intelligent features');

    // Initialize all automated jobs
    startCreateGeneralAlphaJob();
    startResolveWfaBookingsJob();
    startAutoCheckoutJob();

    logger.info('All automated attendance jobs have been scheduled.');
  } catch (err) {
    logger.error('Database connection failed:', err.message);
    logger.warn('Server will start without database connection');
  }

  app.listen(config.port, () => {
    logger.info(`Server 🚀 on port ${config.port}`);
    console.log(`🚀 Server running on port ${config.port}`);
    console.log(`📚 API Documentation: http://localhost:${config.port}/docs`);
  });
})();
