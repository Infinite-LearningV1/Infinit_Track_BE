import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

const { executeJobWithTimeout, processBatchRecords, createTimer } = await import(
  '../src/utils/jobHelper.js'
);

/**
 * Characterization coverage for the shared job infrastructure
 * (INF-252, Phase 6 groundwork).
 *
 * `executeJobWithTimeout` wraps **all three** state-changing background jobs.
 * `processBatchRecords` drives the missed-checkout flagger. Neither had any
 * test.
 *
 * Two defects surfaced while writing these, both recorded rather than fixed:
 * the timeout does not actually stop the job it claims to terminate (F44),
 * and offset paging skips records when the batch callback mutates the set it
 * selected on (F45).
 */

describe('executeJobWithTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns whatever the job returns', async () => {
    const result = await executeJobWithTimeout('demo', async () => ({ flagged: 3 }));
    expect(result).toEqual({ flagged: 3 });
  });

  it('rethrows a job failure unchanged', async () => {
    const boom = new Error('job blew up');
    await expect(executeJobWithTimeout('demo', async () => Promise.reject(boom))).rejects.toBe(
      boom
    );
  });

  it('rejects once the timeout elapses', async () => {
    jest.useFakeTimers();

    const pending = executeJobWithTimeout('demo', () => new Promise(() => {}), 1000);
    const assertion = expect(pending).rejects.toThrow(/exceeded timeout of 1 seconds/);

    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  /**
   * F44, characterized not fixed.
   *
   * The timeout message says the job "was terminated". It was not.
   * Promise.race only decides which promise settles first -- the job function
   * keeps running, keeps holding connections, and keeps writing.
   *
   * For the three jobs this wraps, that means a timed-out run continues
   * mutating final attendance state after the caller has been told it failed,
   * and can still be running when the next scheduled run begins.
   */
  it('does not actually stop the job it reports as terminated', async () => {
    jest.useFakeTimers();

    let sideEffects = 0;
    let release;
    const job = async () => {
      sideEffects += 1;
      await new Promise((resolve) => {
        release = resolve;
      });
      sideEffects += 1; // still runs after the timeout has been reported
      return 'done';
    };

    const pending = executeJobWithTimeout('demo', job, 1000);
    const assertion = expect(pending).rejects.toThrow(/exceeded timeout/);

    await jest.advanceTimersByTimeAsync(1000);
    await assertion;

    expect(sideEffects).toBe(1);

    // The job was never cancelled: letting it continue still runs its tail.
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(sideEffects).toBe(2);
  });
});

describe('processBatchRecords paging', () => {
  const modelReturning = (...batches) => {
    const findAll = jest.fn();
    batches.forEach((b) => findAll.mockResolvedValueOnce(b));
    findAll.mockResolvedValue([]);
    return { findAll };
  };

  const rows = (n, from = 0) =>
    Array.from({ length: n }, (_, i) => ({ id_attendance: from + i + 1 }));

  it('reports nothing to do for an empty result', async () => {
    const model = modelReturning([]);
    const processBatch = jest.fn();

    const result = await processBatchRecords(model, { where: {} }, processBatch, 100);

    expect(result).toEqual({ totalProcessed: 0, totalBatches: 1 });
    expect(processBatch).not.toHaveBeenCalled();
  });

  it('stops after a batch shorter than the batch size', async () => {
    const model = modelReturning(rows(3));
    const processBatch = jest.fn();

    const result = await processBatchRecords(model, { where: {} }, processBatch, 100);

    expect(model.findAll).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ totalProcessed: 3, totalBatches: 1 });
  });

  it('advances the offset by the batch size between full batches', async () => {
    const model = modelReturning(rows(2), rows(1, 2));
    const processBatch = jest.fn();

    await processBatchRecords(model, { where: { time_out: null } }, processBatch, 2);

    expect(model.findAll).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { time_out: null }, limit: 2, offset: 0 })
    );
    expect(model.findAll).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ limit: 2, offset: 2 })
    );
  });

  it('passes the batch and its number to the callback', async () => {
    const batch = rows(2);
    const model = modelReturning(batch);
    const processBatch = jest.fn();

    await processBatchRecords(model, {}, processBatch, 100);

    expect(processBatch).toHaveBeenCalledWith(batch, 1);
  });

  it('continues past a failing batch without counting its records', async () => {
    const model = modelReturning(rows(2), rows(2, 2), rows(1, 4));
    const processBatch = jest
      .fn()
      .mockRejectedValueOnce(new Error('batch 1 failed'))
      .mockResolvedValue(undefined);

    const result = await processBatchRecords(model, {}, processBatch, 2);

    expect(processBatch).toHaveBeenCalledTimes(3);
    // The two records in the failed batch are not counted as processed.
    expect(result.totalProcessed).toBe(3);
    expect(result.totalBatches).toBe(3);
  });
});

describe('processBatchRecords with a mutating callback', () => {
  /**
   * F45, characterized not fixed.
   *
   * Paging is offset-based against a live query. The missed-checkout flagger
   * filters on `time_out: null` and then closes the rows it selected, so each
   * processed batch leaves the matching set. The next page asks for
   * `offset: batchSize` against a set that has already shrunk by exactly that
   * much -- and gets nothing back.
   *
   * With 200 open sessions and a batch size of 100, one run processes 100 and
   * silently stops. The flagger self-heals because it runs every 30 minutes,
   * but the closure is delayed by a full cycle and totalProcessed
   * under-reports.
   */
  it('skips the remainder when processed rows leave the filtered set', async () => {
    const BATCH = 100;
    let remaining = 200;

    const model = {
      findAll: jest.fn(async ({ offset }) => {
        // Rows that have been processed no longer match the filter, so the
        // result set is `remaining`, and offset indexes into that.
        const available = Math.max(0, remaining - offset);
        return rowsOf(Math.min(BATCH, available));
      })
    };

    function rowsOf(n) {
      return Array.from({ length: n }, (_, i) => ({ id: i }));
    }

    const processBatch = jest.fn(async (batch) => {
      remaining -= batch.length; // the callback closes them
    });

    const result = await processBatchRecords(model, { where: { time_out: null } }, processBatch, BATCH);

    // Only the first page was processed, out of two pages' worth of work.
    expect(result.totalProcessed).toBe(BATCH);
    expect(remaining).toBe(100);
  });
});

describe('createTimer', () => {
  it('returns an object that can be ended without throwing', () => {
    const timer = createTimer('demo');
    expect(typeof timer.end).toBe('function');
    expect(() => timer.end()).not.toThrow();
  });
});
