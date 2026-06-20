import sequelize from '../config/database.js';
import logger from '../utils/logger.js';
import { ensureSchedulerStarted } from '../utils/schedulerLifecycle.js';
import {
  getReadinessSnapshot,
  markDatabaseReady,
  markDatabaseUnready
} from '../utils/readinessState.js';

export const getLiveness = (_req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString()
  });
};

export const getReadiness = async (_req, res) => {
  const previousReadiness = getReadinessSnapshot();

  try {
    await sequelize.authenticate();
    markDatabaseReady();

    if (previousReadiness.components.database !== 'ready') {
      logger.info('Readiness database probe recovered.');
    }

    const readinessAfterDatabaseProbe = getReadinessSnapshot();

    if (readinessAfterDatabaseProbe.components.scheduler !== 'ready') {
      try {
        await ensureSchedulerStarted({ source: 'health' });
      } catch (schedulerError) {
        logger.warn('Readiness scheduler recovery failed.', {
          error: schedulerError.message,
          stack: schedulerError.stack
        });
      }
    }
  } catch (error) {
    markDatabaseUnready();

    if (previousReadiness.components.database !== 'not_ready') {
      logger.warn('Readiness database probe failed.', {
        name: error.name,
        error: error.message,
        code: error.original?.code || error.parent?.code || error.code,
        stack: error.stack
      });
    }
  }

  const readiness = getReadinessSnapshot();

  res.status(readiness.ready ? 200 : 503).json(readiness);
};
