import { startAutoCheckoutJob } from '../jobs/autoCheckout.job.js';
import { startCreateGeneralAlphaJob } from '../jobs/createGeneralAlpha.job.js';
import { startResolveWfaBookingsJob } from '../jobs/resolveWfaBookings.job.js';
import logger from './logger.js';
import {
  getReadinessSnapshot,
  markSchedulerReady,
  markSchedulerUnready
} from './readinessState.js';

const schedulerStarters = [
  { name: 'createGeneralAlpha', start: startCreateGeneralAlphaJob },
  { name: 'resolveWfaBookings', start: startResolveWfaBookingsJob },
  { name: 'autoCheckout', start: startAutoCheckoutJob }
];

let activeTasks = [];
let activeTaskSetComplete = false;
let startPromise = null;

function isManageableTask(task) {
  return Boolean(task && (typeof task.destroy === 'function' || typeof task.stop === 'function'));
}

function normalizeStartedTasks(result, jobName) {
  const tasks = Array.isArray(result) ? result : [result];

  if (tasks.length === 0 || tasks.some((task) => !isManageableTask(task))) {
    throw new Error(`Scheduler job ${jobName} did not return manageable cron task handle(s)`);
  }

  return tasks;
}

function stopScheduledTask(task) {
  if (typeof task?.destroy === 'function') {
    task.destroy();
    return;
  }

  if (typeof task?.stop === 'function') {
    task.stop();
  }
}

function stopTaskHandles(tasks) {
  const rollbackTasks = [...tasks].reverse();
  const stopFailures = [];

  for (const task of rollbackTasks) {
    try {
      stopScheduledTask(task);
    } catch (error) {
      stopFailures.push({ task, error });
      logger.warn('Scheduler task stop failed:', error);
    }
  }

  return stopFailures;
}

function createStopFailureError(message, stopFailures, primaryError) {
  const errors = [
    ...(primaryError ? [primaryError] : []),
    ...stopFailures.map(({ error }) => error)
  ];

  return new AggregateError(errors, message);
}

async function startScheduler({ source }) {
  const startedTasks = [];
  let failedJob;

  try {
    for (const { name, start } of schedulerStarters) {
      failedJob = name;
      const tasks = normalizeStartedTasks(await start(), name);
      startedTasks.push(...tasks);
    }

    activeTasks = startedTasks;
    activeTaskSetComplete = true;
    markSchedulerReady();
    logger.info('All automated attendance jobs have been scheduled.', {
      source,
      taskCount: activeTasks.length
    });

    return { started: true, taskCount: activeTasks.length };
  } catch (error) {
    const stopFailures = stopTaskHandles(startedTasks);
    activeTasks = stopFailures.map(({ task }) => task);
    activeTaskSetComplete = false;
    markSchedulerUnready();
    logger.error('Automated job scheduling failed', {
      source,
      failedJob,
      rolledBackTasks: startedTasks.length - stopFailures.length,
      failedRollbackTasks: stopFailures.length,
      rollbackErrors: stopFailures.map(({ error: stopError }) => stopError.message),
      error: error.message,
      stack: error.stack
    });

    if (stopFailures.length > 0) {
      throw createStopFailureError(
        'Automated job scheduling failed and rollback did not stop all task handles',
        stopFailures,
        error
      );
    }

    throw error;
  }
}

export async function ensureSchedulerStarted({ source = 'unknown' } = {}) {
  if (activeTasks.length > 0) {
    if (!activeTaskSetComplete) {
      stopSchedulerJobs({ source: `${source}:rollback-retry` });
    } else {
      const readiness = getReadinessSnapshot();

      if (readiness.components.scheduler !== 'ready') {
        markSchedulerReady();
      }

      return { started: false, taskCount: activeTasks.length };
    }
  }

  if (!startPromise) {
    startPromise = startScheduler({ source });
  }

  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

export function stopSchedulerJobs({ source = 'unknown' } = {}) {
  const taskCount = activeTasks.length;
  const stopFailures = stopTaskHandles(activeTasks);

  if (stopFailures.length > 0) {
    activeTasks = stopFailures.map(({ task }) => task);
    activeTaskSetComplete = false;
    markSchedulerUnready();
    logger.error('Automated attendance jobs stop failed.', {
      source,
      taskCount,
      failedStopTasks: stopFailures.length,
      stopErrors: stopFailures.map(({ error }) => error.message)
    });
    throw createStopFailureError('Automated attendance jobs stop failed.', stopFailures);
  }

  activeTasks = [];
  activeTaskSetComplete = false;
  markSchedulerUnready();
  logger.info('Automated attendance jobs have been stopped.', { source, taskCount });

  return { stopped: taskCount };
}
