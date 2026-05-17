import { jest } from '@jest/globals';

function createTask(name) {
  return {
    name,
    destroy: jest.fn(),
    stop: jest.fn()
  };
}

async function mockJobDependencies({ scheduleImpl } = {}) {
  jest.resetModules();

  const schedule = scheduleImpl ?? jest.fn(() => createTask('scheduled-task'));

  jest.unstable_mockModule('node-cron', () => ({
    default: { schedule }
  }));

  jest.unstable_mockModule('../src/models/index.js', () => ({
    Attendance: {},
    AttendanceCategory: {},
    Booking: {},
    LocationEvent: {},
    Role: {},
    User: {}
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    }
  }));

  jest.unstable_mockModule('../src/utils/jobHelper.js', () => ({
    executeJobWithTimeout: jest.fn(),
    processBatchRecords: jest.fn()
  }));

  jest.unstable_mockModule('../src/utils/attendanceDuplicateError.js', () => ({
    isAttendanceDuplicateConstraintError: jest.fn(() => false)
  }));

  jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
    calculateWorkHour: jest.fn(() => 8),
    formatTimeOnly: jest.fn(() => '18:00:00')
  }));

  jest.unstable_mockModule('../src/utils/settings.js', () => ({
    getOperationalSettings: jest.fn(() => ({
      defaultShiftEnd: '18:00:00',
      lateCheckoutToleranceMin: 30
    }))
  }));

  jest.unstable_mockModule('../src/utils/geofence.js', () => ({
    toJakartaTime: jest.fn((date) => date)
  }));

  jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
    default: {
      weightedPrediction: jest.fn(() => null)
    }
  }));

  jest.unstable_mockModule('../src/analytics/fahp.js', () => ({
    computeCR: jest.fn(() => ({ CR: 0 })),
    defuzzifyMatrixTFN: jest.fn(() => [])
  }));

  jest.unstable_mockModule('../src/analytics/fahp.extent.js', () => ({
    extentWeightsTFN: jest.fn(() => [0.25, 0.25, 0.25, 0.25])
  }));

  jest.unstable_mockModule('../src/analytics/config.fahp.js', () => ({
    SMART_AC_PAIRWISE_TFN: []
  }));

  return { schedule };
}

describe('scheduler job handle contracts', () => {
  let consoleLogSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    jest.clearAllMocks();
    jest.resetModules();
  });

  test('create general alpha starter returns its cron handle without changing schedule semantics', async () => {
    const task = createTask('create-general-alpha');
    const { schedule } = await mockJobDependencies({
      scheduleImpl: jest.fn(() => task)
    });
    const { startCreateGeneralAlphaJob } = await import('../src/jobs/createGeneralAlpha.job.js');

    const result = startCreateGeneralAlphaJob();

    expect(result).toBe(task);
    expect(schedule).toHaveBeenCalledWith('55 23 * * 1-5', expect.any(Function), {
      scheduled: true,
      timezone: 'Asia/Jakarta'
    });
  });

  test('resolve WFA bookings starter returns its cron handle without changing schedule semantics', async () => {
    const task = createTask('resolve-wfa-bookings');
    const { schedule } = await mockJobDependencies({
      scheduleImpl: jest.fn(() => task)
    });
    const { startResolveWfaBookingsJob } = await import('../src/jobs/resolveWfaBookings.job.js');

    const result = startResolveWfaBookingsJob();

    expect(result).toBe(task);
    expect(schedule).toHaveBeenCalledWith('50 23 * * *', expect.any(Function), {
      scheduled: true,
      timezone: 'Asia/Jakarta'
    });
  });

  test('auto checkout starter returns both cron handles without changing schedule semantics', async () => {
    const missedCheckoutTask = createTask('missed-checkout');
    const smartAutoCheckoutTask = createTask('smart-auto-checkout');
    const { schedule } = await mockJobDependencies({
      scheduleImpl: jest.fn().mockReturnValueOnce(missedCheckoutTask).mockReturnValueOnce(smartAutoCheckoutTask)
    });
    const { startAutoCheckoutJob } = await import('../src/jobs/autoCheckout.job.js');

    const result = startAutoCheckoutJob();

    expect(result).toEqual([missedCheckoutTask, smartAutoCheckoutTask]);
    expect(schedule).toHaveBeenNthCalledWith(1, '*/30 * * * *', expect.any(Function), {
      scheduled: true,
      timezone: 'Asia/Jakarta'
    });
    expect(schedule).toHaveBeenNthCalledWith(2, '45 23 * * *', expect.any(Function), {
      scheduled: true,
      timezone: 'Asia/Jakarta'
    });
  });

  test('auto checkout starter rolls back the first cron handle when the second schedule fails', async () => {
    const missedCheckoutTask = createTask('missed-checkout');
    const scheduleError = new Error('schedule failed');
    await mockJobDependencies({
      scheduleImpl: jest
        .fn()
        .mockReturnValueOnce(missedCheckoutTask)
        .mockImplementationOnce(() => {
          throw scheduleError;
        })
    });
    const { startAutoCheckoutJob } = await import('../src/jobs/autoCheckout.job.js');

    expect(() => startAutoCheckoutJob()).toThrow(scheduleError);
    expect(missedCheckoutTask.destroy).toHaveBeenCalledTimes(1);
    expect(missedCheckoutTask.stop).not.toHaveBeenCalled();
  });

  test('auto checkout starter rolls back the first cron handle when the second schedule returns an invalid handle', async () => {
    const missedCheckoutTask = createTask('missed-checkout');
    await mockJobDependencies({
      scheduleImpl: jest.fn().mockReturnValueOnce(missedCheckoutTask).mockReturnValueOnce(undefined)
    });
    const { startAutoCheckoutJob } = await import('../src/jobs/autoCheckout.job.js');

    expect(() => startAutoCheckoutJob()).toThrow(
      'Auto checkout schedule smartAutoCheckout did not return manageable cron task handle'
    );
    expect(missedCheckoutTask.destroy).toHaveBeenCalledTimes(1);
    expect(missedCheckoutTask.stop).not.toHaveBeenCalled();
  });

  test('auto checkout starter surfaces rollback failure when the second schedule fails', async () => {
    const missedCheckoutTask = createTask('missed-checkout');
    missedCheckoutTask.destroy.mockImplementationOnce(() => {
      throw new Error('destroy failed');
    });
    const scheduleError = new Error('schedule failed');
    await mockJobDependencies({
      scheduleImpl: jest
        .fn()
        .mockReturnValueOnce(missedCheckoutTask)
        .mockImplementationOnce(() => {
          throw scheduleError;
        })
    });
    const { startAutoCheckoutJob } = await import('../src/jobs/autoCheckout.job.js');

    expect(() => startAutoCheckoutJob()).toThrow(
      'Auto checkout scheduling failed and rollback did not stop all task handles'
    );
    expect(missedCheckoutTask.destroy).toHaveBeenCalledTimes(1);
  });
});
