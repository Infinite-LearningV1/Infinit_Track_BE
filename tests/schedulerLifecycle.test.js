import { jest } from '@jest/globals';

function createTask(name, methods = ['destroy']) {
  return {
    name,
    ...(methods.includes('destroy') ? { destroy: jest.fn() } : {}),
    ...(methods.includes('stop') ? { stop: jest.fn() } : {})
  };
}

async function loadSchedulerLifecycle({ createStart, resolveStart, autoStart } = {}) {
  jest.resetModules();

  const startCreateGeneralAlphaJob = createStart ?? jest.fn(() => createTask('create-general-alpha'));
  const startResolveWfaBookingsJob = resolveStart ?? jest.fn(() => createTask('resolve-wfa-bookings'));
  const startAutoCheckoutJob = autoStart ?? jest.fn(() => [createTask('missed-checkout')]);

  jest.unstable_mockModule('../src/jobs/createGeneralAlpha.job.js', () => ({
    startCreateGeneralAlphaJob
  }));

  jest.unstable_mockModule('../src/jobs/resolveWfaBookings.job.js', () => ({
    startResolveWfaBookingsJob
  }));

  jest.unstable_mockModule('../src/jobs/autoCheckout.job.js', () => ({
    startAutoCheckoutJob
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    }
  }));

  const lifecycle = await import('../src/utils/schedulerLifecycle.js');
  const readinessState = await import('../src/utils/readinessState.js');

  return {
    ...lifecycle,
    ...readinessState,
    startCreateGeneralAlphaJob,
    startResolveWfaBookingsJob,
    startAutoCheckoutJob
  };
}

describe('scheduler lifecycle', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('starts all scheduler jobs and marks the scheduler ready', async () => {
    const createTaskHandle = createTask('create-general-alpha');
    const resolveTaskHandle = createTask('resolve-wfa-bookings');
    const autoTaskHandle = createTask('auto-checkout');
    const harness = await loadSchedulerLifecycle({
      createStart: jest.fn(() => createTaskHandle),
      resolveStart: jest.fn(() => resolveTaskHandle),
      autoStart: jest.fn(() => [autoTaskHandle])
    });

    const result = await harness.ensureSchedulerStarted({ source: 'test' });

    expect(result).toEqual({ started: true, taskCount: 3 });
    expect(harness.startCreateGeneralAlphaJob).toHaveBeenCalledTimes(1);
    expect(harness.startResolveWfaBookingsJob).toHaveBeenCalledTimes(1);
    expect(harness.startAutoCheckoutJob).toHaveBeenCalledTimes(1);
    expect(harness.getReadinessSnapshot().components.scheduler).toBe('ready');
  });

  test('does not start duplicate jobs when handles are already active', async () => {
    const harness = await loadSchedulerLifecycle();

    const firstResult = await harness.ensureSchedulerStarted({ source: 'first' });
    const secondResult = await harness.ensureSchedulerStarted({ source: 'second' });

    expect(firstResult).toEqual({ started: true, taskCount: 3 });
    expect(secondResult).toEqual({ started: false, taskCount: 3 });
    expect(harness.startCreateGeneralAlphaJob).toHaveBeenCalledTimes(1);
    expect(harness.startResolveWfaBookingsJob).toHaveBeenCalledTimes(1);
    expect(harness.startAutoCheckoutJob).toHaveBeenCalledTimes(1);
  });

  test('coalesces concurrent startup attempts into one scheduler registration', async () => {
    let releaseCreateJob;
    const createJobStarted = new Promise((resolve) => {
      releaseCreateJob = resolve;
    });
    const harness = await loadSchedulerLifecycle({
      createStart: jest.fn(async () => {
        await createJobStarted;
        return createTask('create-general-alpha');
      })
    });

    const firstStart = harness.ensureSchedulerStarted({ source: 'first' });
    const secondStart = harness.ensureSchedulerStarted({ source: 'second' });

    expect(harness.startCreateGeneralAlphaJob).toHaveBeenCalledTimes(1);
    releaseCreateJob();

    await expect(Promise.all([firstStart, secondStart])).resolves.toEqual([
      { started: true, taskCount: 3 },
      { started: true, taskCount: 3 }
    ]);
    expect(harness.startResolveWfaBookingsJob).toHaveBeenCalledTimes(1);
    expect(harness.startAutoCheckoutJob).toHaveBeenCalledTimes(1);
  });

  test('rolls back started task handles when a later scheduler job fails', async () => {
    const createTaskHandle = createTask('create-general-alpha');
    const schedulerError = new Error('resolve failed');
    const harness = await loadSchedulerLifecycle({
      createStart: jest.fn(() => createTaskHandle),
      resolveStart: jest.fn(() => {
        throw schedulerError;
      })
    });

    await expect(harness.ensureSchedulerStarted({ source: 'test' })).rejects.toThrow(schedulerError);

    expect(createTaskHandle.destroy).toHaveBeenCalledTimes(1);
    expect(harness.startAutoCheckoutJob).not.toHaveBeenCalled();
    expect(harness.getReadinessSnapshot().components.scheduler).toBe('not_ready');
  });

  test('retries failed rollback cleanup before registering new scheduler jobs', async () => {
    const firstCreateTask = createTask('first-create-general-alpha');
    firstCreateTask.destroy.mockImplementationOnce(() => {
      throw new Error('destroy failed');
    });
    const secondCreateTask = createTask('second-create-general-alpha');
    const resolveTaskHandle = createTask('resolve-wfa-bookings');
    const autoTaskHandle = createTask('auto-checkout');
    const harness = await loadSchedulerLifecycle({
      createStart: jest.fn().mockReturnValueOnce(firstCreateTask).mockReturnValueOnce(secondCreateTask),
      resolveStart: jest
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('resolve failed');
        })
        .mockReturnValueOnce(resolveTaskHandle),
      autoStart: jest.fn(() => [autoTaskHandle])
    });

    await expect(harness.ensureSchedulerStarted({ source: 'first' })).rejects.toThrow(
      'Automated job scheduling failed and rollback did not stop all task handles'
    );
    const retryResult = await harness.ensureSchedulerStarted({ source: 'retry' });

    expect(firstCreateTask.destroy).toHaveBeenCalledTimes(2);
    expect(retryResult).toEqual({ started: true, taskCount: 3 });
    expect(harness.startCreateGeneralAlphaJob).toHaveBeenCalledTimes(2);
    expect(harness.startResolveWfaBookingsJob).toHaveBeenCalledTimes(2);
    expect(harness.startAutoCheckoutJob).toHaveBeenCalledTimes(1);
    expect(harness.getReadinessSnapshot().components.scheduler).toBe('ready');
  });

  test('can retry scheduler startup after a failed attempt', async () => {
    const firstCreateTask = createTask('first-create-general-alpha');
    const secondCreateTask = createTask('second-create-general-alpha');
    const resolveTaskHandle = createTask('resolve-wfa-bookings');
    const autoTaskHandle = createTask('auto-checkout');
    const harness = await loadSchedulerLifecycle({
      createStart: jest.fn().mockReturnValueOnce(firstCreateTask).mockReturnValueOnce(secondCreateTask),
      resolveStart: jest
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('first attempt failed');
        })
        .mockReturnValueOnce(resolveTaskHandle),
      autoStart: jest.fn(() => [autoTaskHandle])
    });

    await expect(harness.ensureSchedulerStarted({ source: 'first' })).rejects.toThrow(
      'first attempt failed'
    );
    const retryResult = await harness.ensureSchedulerStarted({ source: 'retry' });

    expect(firstCreateTask.destroy).toHaveBeenCalledTimes(1);
    expect(retryResult).toEqual({ started: true, taskCount: 3 });
    expect(harness.startCreateGeneralAlphaJob).toHaveBeenCalledTimes(2);
    expect(harness.startResolveWfaBookingsJob).toHaveBeenCalledTimes(2);
    expect(harness.startAutoCheckoutJob).toHaveBeenCalledTimes(1);
    expect(harness.getReadinessSnapshot().components.scheduler).toBe('ready');
  });

  test('stops active scheduler jobs and marks the scheduler unready', async () => {
    const createTaskHandle = createTask('create-general-alpha');
    const resolveTaskHandle = createTask('resolve-wfa-bookings', ['stop']);
    const autoTaskHandle = createTask('auto-checkout');
    const harness = await loadSchedulerLifecycle({
      createStart: jest.fn(() => createTaskHandle),
      resolveStart: jest.fn(() => resolveTaskHandle),
      autoStart: jest.fn(() => [autoTaskHandle])
    });

    await harness.ensureSchedulerStarted({ source: 'test' });
    const result = harness.stopSchedulerJobs({ source: 'test' });

    expect(result).toEqual({ stopped: 3 });
    expect(autoTaskHandle.destroy).toHaveBeenCalledTimes(1);
    expect(resolveTaskHandle.stop).toHaveBeenCalledTimes(1);
    expect(createTaskHandle.destroy).toHaveBeenCalledTimes(1);
    expect(harness.getReadinessSnapshot().components.scheduler).toBe('not_ready');
  });

  test('rejects scheduler jobs that do not return manageable task handles', async () => {
    const harness = await loadSchedulerLifecycle({
      createStart: jest.fn(() => undefined)
    });

    await expect(harness.ensureSchedulerStarted({ source: 'test' })).rejects.toThrow(
      'Scheduler job createGeneralAlpha did not return manageable cron task handle(s)'
    );
    expect(harness.getReadinessSnapshot().components.scheduler).toBe('not_ready');
  });
});
