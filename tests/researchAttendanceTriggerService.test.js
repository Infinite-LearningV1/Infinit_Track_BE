import { jest } from '@jest/globals';

let featureEnabled = true;

jest.unstable_mockModule('../src/config/index.js', () => ({
  __esModule: true,
  default: {
    get researchAttendanceTriggerEnabled() {
      return featureEnabled;
    }
  }
}));

const { executeResearchAttendanceTrigger, buildResearchAttendanceTriggerPlan } = await import(
  '../src/services/researchAttendanceTrigger.service.js'
);

describe('research attendance trigger service', () => {
  beforeEach(() => {
    featureEnabled = true;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns a deterministic dry-run summary for the daily endpoint', async () => {
    const collectSnapshot = jest.fn(async () => ({
      dbIdentity: { host: '127.0.0.1', port: 3306, database: 'v1_infinite_track' }
    }));
    const buildPlan = jest.fn(async () => ({
      policy: { allow_non_working_day: false, skip_existing: true },
      population: {
        source: 'existing July 2025 attendance baseline',
        baseline_user_count: 10,
        eligible_user_count: 8,
        selected_user_count: 3
      },
      mode_summary: {
        wfo: 2,
        wfh: 1,
        wfa: 0
      },
      warnings: [],
      conflicts: [],
      skipped_existing: 1,
      skipped_conflict: 0,
      plannedAttendanceRows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      plannedBookingRows: [],
      plannedLocationEventRows: [{ id: 1 }]
    }));

    const result = await executeResearchAttendanceTrigger({
      endpointType: 'daily',
      body: {
        target_date: '2026-07-01',
        dry_run: true
      },
      user: { id: 99, role_name: 'Admin' },
      dependencies: {
        isNonWorkingDay: () => false,
        collectSnapshot,
        buildPlan,
        applyPlan: jest.fn()
      }
    });

    expect(result).toMatchObject({
      success: true,
      endpoint_type: 'daily',
      mode: 'dry-run',
      target_date: '2026-07-01',
      seed: '2026-07-01:daily',
      policy: {
        allow_non_working_day: false,
        skip_existing: true
      },
      population: {
        source: 'existing July 2025 attendance baseline',
        baseline_user_count: 10,
        eligible_user_count: 8,
        selected_user_count: 3
      },
      mode_summary: {
        wfo: 2,
        wfh: 1,
        wfa: 0
      },
      planned_writes: {
        attendance: 3,
        bookings: 0,
        location_events: 1
      },
      skipped_existing: 1,
      skipped_conflict: 0
    });
    expect(collectSnapshot).toHaveBeenCalled();
    expect(buildPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointType: 'daily',
        targetDate: '2026-07-01',
        seed: '2026-07-01:daily'
      })
    );
  });

  it('rejects a non-working day when allow_non_working_day is false', async () => {
    await expect(
      executeResearchAttendanceTrigger({
        endpointType: 'full-day',
        body: {
          target_date: '2026-07-05',
          dry_run: true,
          allow_non_working_day: false
        },
        user: { id: 77, role_name: 'Management' },
        dependencies: {
          isNonWorkingDay: () => true,
          collectSnapshot: jest.fn(),
          buildPlan: jest.fn(),
          applyPlan: jest.fn()
        }
      })
    ).rejects.toMatchObject({
      status: 409,
      code: 'E_NON_WORKING_DAY'
    });
  });

  it('builds a deterministic daily subset plan using 30 percent of eligible users', async () => {
    const snapshot = {
      baselineUsers: [
        { userId: 1, role_name: 'Internship' },
        { userId: 2, role_name: 'Internship' },
        { userId: 3, role_name: 'Internship' },
        { userId: 4, role_name: 'Internship' },
        { userId: 5, role_name: 'Internship' },
        { userId: 6, role_name: 'Internship' },
        { userId: 7, role_name: 'Employee' },
        { userId: 8, role_name: 'Employee' },
        { userId: 9, role_name: 'Admin' },
        { userId: 10, role_name: 'Management' }
      ],
      existingAttendanceRows: [],
      existingBookingRows: [],
      existingLocationEvents: [],
      expectedLocationsByUser: {
        1: { wfoLocationId: 101, wfhLocationId: 201, fallbackWfaLocationId: 301 },
        2: { wfoLocationId: 102, wfhLocationId: 202, fallbackWfaLocationId: 302 },
        3: { wfoLocationId: 103, wfhLocationId: 203, fallbackWfaLocationId: 303 },
        4: { wfoLocationId: 104, wfhLocationId: 204, fallbackWfaLocationId: 304 },
        5: { wfoLocationId: 105, wfhLocationId: 205, fallbackWfaLocationId: 305 },
        6: { wfoLocationId: 106, wfhLocationId: 206, fallbackWfaLocationId: 306 },
        7: { wfoLocationId: 107, wfhLocationId: 207, fallbackWfaLocationId: 307 },
        8: { wfoLocationId: 108, wfhLocationId: 208, fallbackWfaLocationId: 308 },
        9: { wfoLocationId: 109, wfhLocationId: 209, fallbackWfaLocationId: 309 },
        10: { wfoLocationId: 110, wfhLocationId: 210, fallbackWfaLocationId: 310 }
      }
    };

    const first = await buildResearchAttendanceTriggerPlan({
      endpointType: 'daily',
      targetDate: '2026-07-01',
      seed: '2026-07-01:daily',
      request: { allowNonWorkingDay: false },
      snapshot,
      user: { id: 99, role_name: 'Admin' }
    });
    const second = await buildResearchAttendanceTriggerPlan({
      endpointType: 'daily',
      targetDate: '2026-07-01',
      seed: '2026-07-01:daily',
      request: { allowNonWorkingDay: false },
      snapshot,
      user: { id: 99, role_name: 'Admin' }
    });

    expect(first.population).toMatchObject({
      baseline_user_count: 10,
      eligible_user_count: 10,
      selected_user_count: 3
    });
    expect(first.selection_summary.target_user_ids).toEqual(second.selection_summary.target_user_ids);
    expect(first.plannedAttendanceRows).toHaveLength(3);
  });

  it('targets the full eligible population for the full-day endpoint', async () => {
    const plan = await buildResearchAttendanceTriggerPlan({
      endpointType: 'full-day',
      targetDate: '2026-07-01',
      seed: '2026-07-01:full-day',
      request: { allowNonWorkingDay: false },
      snapshot: {
        baselineUsers: [
          { userId: 1, role_name: 'Internship' },
          { userId: 2, role_name: 'Employee' },
          { userId: 3, role_name: 'Admin' }
        ],
        existingAttendanceRows: [],
        existingBookingRows: [],
        existingLocationEvents: [],
        expectedLocationsByUser: {
          1: { wfoLocationId: 101, wfhLocationId: 201, fallbackWfaLocationId: 301 },
          2: { wfoLocationId: 102, wfhLocationId: 202, fallbackWfaLocationId: 302 },
          3: { wfoLocationId: 103, wfhLocationId: 203, fallbackWfaLocationId: 303 }
        }
      },
      user: { id: 99, role_name: 'Admin' }
    });

    expect(plan.population).toMatchObject({
      baseline_user_count: 3,
      eligible_user_count: 3,
      selected_user_count: 3
    });
    expect(plan.selection_summary.target_user_ids).toHaveLength(3);
    expect(plan.plannedAttendanceRows).toHaveLength(3);
  });

  it('returns an apply response when confirmation is valid and writes succeed', async () => {
    const applyPlan = jest.fn(async () => ({
      attendance: 2,
      bookings: 1,
      locationEvents: 4
    }));

    const result = await executeResearchAttendanceTrigger({
      endpointType: 'full-day',
      body: {
        target_date: '2026-07-01',
        dry_run: false,
        confirm: 'I_UNDERSTAND_THIS_WRITES_ATTENDANCE'
      },
      user: { id: 7, role_name: 'Management' },
      dependencies: {
        isNonWorkingDay: () => false,
        collectSnapshot: jest.fn(async () => ({ dbIdentity: {} })),
        buildPlan: jest.fn(async () => ({
          policy: { allow_non_working_day: false, skip_existing: true },
          population: {
            source: 'existing July 2025 attendance baseline',
            baseline_user_count: 2,
            eligible_user_count: 2,
            selected_user_count: 2
          },
          selection_summary: {
            strategy: 'full-population',
            target_user_ids: [10, 11]
          },
          mode_summary: { wfo: 2, wfh: 0, wfa: 0 },
          warnings: [],
          conflicts: [],
          skipped_existing: 0,
          skipped_conflict: 0,
          invalid_reference_count: 0,
          plannedAttendanceRows: [{}, {}],
          plannedBookingRows: [{}],
          plannedLocationEventRows: [{}, {}, {}, {}]
        })),
        applyPlan
      }
    });

    expect(result).toMatchObject({
      success: true,
      endpoint_type: 'full-day',
      mode: 'apply',
      target_date: '2026-07-01',
      seed: '2026-07-01:full-day',
      applied_writes: {
        attendance: 2,
        bookings: 1,
        locationEvents: 4
      }
    });
    expect(applyPlan).toHaveBeenCalled();
  });

  it('blocks apply when the plan reports invalid reference state', async () => {
    const applyPlan = jest.fn();

    await expect(
      executeResearchAttendanceTrigger({
        endpointType: 'daily',
        body: {
          target_date: '2026-07-01',
          dry_run: false,
          confirm: 'I_UNDERSTAND_THIS_WRITES_ATTENDANCE'
        },
        user: { id: 7, role_name: 'Admin' },
        dependencies: {
          isNonWorkingDay: () => false,
          collectSnapshot: jest.fn(async () => ({ dbIdentity: {} })),
          buildPlan: jest.fn(async () => ({
            policy: { allow_non_working_day: false, skip_existing: true },
            population: {
              source: 'existing July 2025 attendance baseline',
              baseline_user_count: 2,
              eligible_user_count: 2,
              selected_user_count: 1
            },
            selection_summary: {
              strategy: 'fixed-percentage',
              subset_percent: 30,
              target_user_ids: [10]
            },
            mode_summary: { wfo: 0, wfh: 0, wfa: 0 },
            warnings: [],
            conflicts: [{ type: 'invalid_reference', user_id: 10 }],
            skipped_existing: 0,
            skipped_conflict: 1,
            invalid_reference_count: 1,
            plannedAttendanceRows: [],
            plannedBookingRows: [],
            plannedLocationEventRows: []
          })),
          applyPlan
        }
      })
    ).rejects.toMatchObject({
      status: 500,
      code: 'E_INVALID_REFERENCE_STATE'
    });
    expect(applyPlan).not.toHaveBeenCalled();
  });

  it('returns a 200-style dry-run no-op summary when all targeted users already have attendance', async () => {
    const result = await executeResearchAttendanceTrigger({
      endpointType: 'daily',
      body: {
        target_date: '2026-07-01',
        dry_run: true
      },
      user: { id: 9, role_name: 'Admin' },
      dependencies: {
        isNonWorkingDay: () => false,
        collectSnapshot: jest.fn(async () => ({ dbIdentity: {} })),
        buildPlan: jest.fn(async () => ({
          policy: { allow_non_working_day: false, skip_existing: true, daily_subset_percent: 30 },
          population: {
            source: 'existing July 2025 attendance baseline',
            baseline_user_count: 4,
            eligible_user_count: 4,
            selected_user_count: 2
          },
          selection_summary: {
            strategy: 'fixed-percentage',
            subset_percent: 30,
            target_user_ids: [1, 2]
          },
          mode_summary: { wfo: 0, wfh: 0, wfa: 0 },
          warnings: ['Semua user target sudah memiliki attendance pada tanggal yang diminta.'],
          conflicts: [],
          skipped_existing: 2,
          skipped_conflict: 0,
          invalid_reference_count: 0,
          plannedAttendanceRows: [],
          plannedBookingRows: [],
          plannedLocationEventRows: []
        })),
        applyPlan: jest.fn()
      }
    });

    expect(result).toMatchObject({
      success: true,
      endpoint_type: 'daily',
      mode: 'dry-run',
      planned_writes: {
        attendance: 0,
        bookings: 0,
        location_events: 0
      },
      skipped_existing: 2,
      warnings: ['Semua user target sudah memiliki attendance pada tanggal yang diminta.']
    });
  });
});
