import { jest } from '@jest/globals';
import { Op } from 'sequelize';

const state = {
  requiredUsers: [],
  attendances: [],
  bookings: [],
  fallbackTime: '17:00:00'
};

const makeAttendance = (seed) => {
  const record = {
    ...seed,
    notes: seed.notes ?? null
  };

  record.update = jest.fn(async (payload) => {
    Object.assign(record, payload);
    return record;
  });

  return record;
};

const makeBooking = (seed) => {
  const record = { ...seed };

  record.update = jest.fn(async (payload) => {
    Object.assign(record, payload);
    return record;
  });

  return record;
};

const resetState = () => {
  state.requiredUsers = [];
  state.attendances = [];
  state.bookings = [];
  state.fallbackTime = '17:00:00';
};

const mockModels = {
  User: {
    findAll: jest.fn(async () => state.requiredUsers)
  },
  Role: {},
  Attendance: {
    findAll: jest.fn(async (query = {}) => {
      const where = query.where || {};

      // GENERAL alpha / WFA resolver (attendance list by date)
      if (where.attendance_date && query.attributes?.includes('user_id')) {
        return state.attendances
          .filter((a) => a.attendance_date === where.attendance_date)
          .map((a) => ({ user_id: a.user_id }));
      }

      // Smart auto-checkout finalized-row query
      if (where.attendance_date && where.time_in?.[Op.not] === null && where.time_out?.[Op.not] === null) {
        return state.attendances.filter(
          (a) => a.attendance_date === where.attendance_date && a.time_in != null && a.time_out != null
        );
      }

      // Smart auto-checkout history/context queries: keep empty for deterministic fallback
      if (where.time_in || where.time_out || where.category_id || where.user_id) {
        return [];
      }

      return [];
    }),
    findOne: jest.fn(async ({ where }) => {
      return (
        state.attendances.find(
          (a) => a.user_id === where.user_id && a.attendance_date === where.attendance_date
        ) || null
      );
    }),
    create: jest.fn(async (payload) => {
      const created = makeAttendance({
        id_attendance: state.attendances.length + 1,
        ...payload
      });
      state.attendances.push(created);
      return created;
    })
  },
  Booking: {
    findAll: jest.fn(async ({ where }) => {
      if (where.status === 1) {
        return state.bookings.filter(
          (b) => b.status === 1 && String(b.schedule_date) === String(where.schedule_date)
        );
      }

      if (where.status === 3 && where.schedule_date?.[Op.lt]) {
        return state.bookings.filter(
          (b) => b.status === 3 && String(b.schedule_date) < String(where.schedule_date[Op.lt])
        );
      }

      return [];
    })
  },
  Settings: {
    findOne: jest.fn(async () => ({ setting_value: state.fallbackTime }))
  },
  LocationEvent: {
    findOne: jest.fn(async () => null)
  },
  AttendanceCategory: {},
  sequelize: {}
};

const mockProcessBatchRecords = jest.fn(async (_model, queryOptions, processBatch) => {
  const where = queryOptions.where || {};
  const batch = state.attendances.filter((a) => {
    if (where.attendance_date && a.attendance_date !== where.attendance_date) return false;
    if (where.time_in?.[Op.not] === null && a.time_in == null) return false;
    if (where.time_out === null && a.time_out != null) return false;
    return true;
  });

  if (batch.length > 0) {
    await processBatch(batch, 1);
  }

  return {
    totalProcessed: batch.length,
    totalBatches: batch.length > 0 ? 1 : 0
  };
});

jest.unstable_mockModule('../src/models/index.js', () => mockModels);
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));
jest.unstable_mockModule('../src/utils/jobHelper.js', () => ({
  executeJobWithTimeout: jest.fn(async (_jobName, fn) => fn()),
  processBatchRecords: mockProcessBatchRecords
}));
jest.unstable_mockModule('date-holidays', () => ({
  default: class MockHolidays {
    isHoliday() {
      return false;
    }
  }
}));
jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
  default: {
    weightedPrediction: jest.fn(() => null)
  }
}));
jest.unstable_mockModule('../src/utils/workHourFormatter.js', () => ({
  calculateWorkHour: jest.fn(() => 8),
  formatTimeOnly: jest.fn(() => '17:00:00')
}));
jest.unstable_mockModule('../src/utils/geofence.js', () => ({
  toJakartaTime: jest.fn((date) => date)
}));
jest.unstable_mockModule('../src/analytics/fahp.js', () => ({
  defuzzifyMatrixTFN: jest.fn(() => [[1]]),
  computeCR: jest.fn(() => ({ CR: 0.05 }))
}));
jest.unstable_mockModule('../src/analytics/fahp.extent.js', () => ({
  extentWeightsTFN: jest.fn(() => [0.4, 0.2, 0.2, 0.2])
}));
jest.unstable_mockModule('../src/analytics/config.fahp.js', () => ({
  SMART_AC_PAIRWISE_TFN: [[[{ l: 1, m: 1, u: 1 }]]]
}));

const { runGeneralAlphaForDate } = await import('../src/jobs/createGeneralAlpha.job.js');
const { resolveWfaBookingsForDate } = await import('../src/jobs/resolveWfaBookings.job.js');
const { runSmartAutoCheckoutForDate } = await import('../src/jobs/autoCheckout.job.js');

describe('INF-23 job idempotency (first-run vs rerun)', () => {
  beforeEach(() => {
    resetState();
    jest.clearAllMocks();
  });

  test('runGeneralAlphaForDate: rerun should be explicit no-op after first mutation', async () => {
    const targetDate = '2026-04-08'; // weekday

    state.requiredUsers = [{ id_users: 101 }];

    const firstRun = await runGeneralAlphaForDate(targetDate);
    const secondRun = await runGeneralAlphaForDate(targetDate);

    expect(firstRun.created).toBe(1);
    // Desired idempotency contract: rerun reports all finalized users as skipped
    expect(secondRun).toEqual({ created: 0, skipped: 1 });
    expect(mockModels.Attendance.create).toHaveBeenCalledTimes(1);
  });

  test('resolveWfaBookingsForDate: rerun should return explicit no-op mutation summary', async () => {
    const targetDate = '2026-04-08';

    state.bookings = [
      makeBooking({
        booking_id: 9001,
        user_id: 200,
        location_id: 7,
        schedule_date: targetDate,
        status: 1
      }),
      makeBooking({
        booking_id: 9002,
        user_id: 300,
        location_id: 8,
        schedule_date: '2026-04-06',
        status: 3
      })
    ];

    await resolveWfaBookingsForDate(targetDate);
    const secondRun = await resolveWfaBookingsForDate(targetDate);

    expect(mockModels.Attendance.create).toHaveBeenCalledTimes(1);
    expect(state.bookings[1].update).toHaveBeenCalledTimes(1);
    // Desired idempotency contract: explicit no-op counters on rerun
    expect(secondRun).toEqual({
      success: true,
      targetDate,
      mutations: {
        createdAlpha: 0,
        rejectedExpired: 0
      }
    });
  });

  test('runSmartAutoCheckoutForDate: rerun should report all previously finalized rows as skipped', async () => {
    const targetDate = '2026-04-08';

    state.attendances = [
      makeAttendance({
        id_attendance: 5001,
        user_id: 777,
        category_id: 1,
        attendance_date: targetDate,
        time_in: new Date(`${targetDate}T09:00:00+07:00`),
        time_out: null,
        attendance_category: { category_name: 'Work From Office' },
        booking: null,
        location_id: 10
      })
    ];

    const firstRun = await runSmartAutoCheckoutForDate(targetDate);
    const secondRun = await runSmartAutoCheckoutForDate(targetDate);

    expect(firstRun.fallbackUsed).toBe(1);
    // Desired idempotency contract: rerun explicitly counts previously finalized records as skipped
    expect(secondRun).toMatchObject({
      targetDate,
      smartUsed: 0,
      fallbackUsed: 0,
      skipped: 1
    });
  });
});
