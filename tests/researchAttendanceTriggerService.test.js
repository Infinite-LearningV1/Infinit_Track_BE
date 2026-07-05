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

const {
  executeResearchAttendanceTrigger,
  buildResearchAttendanceTriggerPlan,
  DEFAULT_DISCIPLINE_MIX,
  RESEARCH_TRIGGER_ATTENDANCE_NOTE
} = await import('../src/services/researchAttendanceTrigger.service.js');

function buildBaselineUsers(totalUsers) {
  return Array.from({ length: totalUsers }, (_, index) => {
    const userId = index + 1;
    let role_name = 'Internship';

    if (userId > 40 && userId <= 50) {
      role_name = 'Employee';
    }

    if (userId === 51) {
      role_name = 'Admin';
    }

    if (userId === 52) {
      role_name = 'Management';
    }

    return {
      userId,
      role_name
    };
  });
}

function buildExpectedLocations(totalUsers) {
  return Object.fromEntries(
    Array.from({ length: totalUsers }, (_, index) => {
      const userId = index + 1;
      return [
        userId,
        {
          wfoLocationId: 1000 + userId,
          wfhLocationId: 2000 + userId,
          fallbackWfaLocationId: 3000 + userId
        }
      ];
    })
  );
}

function createSnapshot(totalUsers = 52, overrides = {}) {
  return {
    baselineUsers: buildBaselineUsers(totalUsers),
    existingAttendanceRows: [],
    existingBookingRows: [],
    existingLocationEvents: [],
    expectedLocationsByUser: buildExpectedLocations(totalUsers),
    ...overrides
  };
}

describe('research attendance trigger service', () => {
  beforeEach(() => {
    featureEnabled = true;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns a deterministic dry-run summary for old request bodies and applies the default discipline mix', async () => {
    const collectSnapshot = jest.fn(async () => ({
      dbIdentity: { host: '127.0.0.1', port: 3306, database: 'v1_infinite_track' }
    }));
    const buildPlan = jest.fn(async ({ request }) => ({
      policy: {
        allow_non_working_day: false,
        existing_strategy: request.existingStrategy,
        skip_existing: true,
        discipline_mix: request.disciplineMix
      },
      population: {
        source: 'existing July 2025 attendance baseline',
        baseline_user_count: 10,
        eligible_user_count: 8,
        selected_user_count: 3
      },
      selection_summary: {
        strategy: 'fixed-percentage',
        subset_percent: 30,
        target_user_ids: [1, 2, 3]
      },
      mode_summary: {
        wfo: 2,
        wfh: 1,
        wfa: 0
      },
      discipline_summary: {
        ontime: 2,
        late: 1,
        early: 0,
        alpha: 0
      },
      warnings: [],
      conflicts: [],
      replacement: {
        attendance: 0,
        location_events: 0
      },
      skipped_existing: 1,
      skipped_conflict: 0,
      plannedAttendanceRows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      plannedBookingRows: [],
      plannedLocationEventRows: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }]
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
      existing_strategy: 'skip',
      policy: {
        allow_non_working_day: false,
        existing_strategy: 'skip',
        skip_existing: true,
        discipline_mix: DEFAULT_DISCIPLINE_MIX
      },
      discipline_summary: {
        ontime: 2,
        late: 1,
        early: 0,
        alpha: 0
      },
      planned_writes: {
        attendance: 3,
        bookings: 0,
        location_events: 6
      },
      would_replace: {
        attendance: 0,
        location_events: 0
      },
      skipped_existing: 1,
      skipped_conflict: 0
    });
    expect(collectSnapshot).toHaveBeenCalled();
    expect(buildPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointType: 'daily',
        targetDate: '2026-07-01',
        seed: '2026-07-01:daily',
        request: expect.objectContaining({
          disciplineMix: DEFAULT_DISCIPLINE_MIX,
          existingStrategy: 'skip',
          seedSuffix: ''
        })
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

  it('rejects an invalid existing strategy', async () => {
    await expect(
      executeResearchAttendanceTrigger({
        endpointType: 'daily',
        body: {
          target_date: '2026-07-01',
          existing_strategy: 'overwrite'
        },
        dependencies: {
          isNonWorkingDay: () => false,
          collectSnapshot: jest.fn(),
          buildPlan: jest.fn(),
          applyPlan: jest.fn()
        }
      })
    ).rejects.toMatchObject({
      status: 400,
      code: 'E_INVALID_EXISTING_STRATEGY'
    });
  });

  it('rejects an invalid discipline mix total', async () => {
    await expect(
      executeResearchAttendanceTrigger({
        endpointType: 'daily',
        body: {
          target_date: '2026-07-01',
          discipline_mix: {
            ontime: 70,
            late: 10,
            early: 10,
            alpha: 5
          }
        },
        dependencies: {
          isNonWorkingDay: () => false,
          collectSnapshot: jest.fn(),
          buildPlan: jest.fn(),
          applyPlan: jest.fn()
        }
      })
    ).rejects.toMatchObject({
      status: 400,
      code: 'E_INVALID_DISCIPLINE_MIX'
    });
  });

  it('uses seed_suffix to vary deterministic daily selection while remaining reproducible', async () => {
    const snapshot = createSnapshot();

    const first = await executeResearchAttendanceTrigger({
      endpointType: 'daily',
      body: {
        target_date: '2026-07-01',
        dry_run: true,
        seed_suffix: 'batch-a'
      },
      dependencies: {
        isNonWorkingDay: () => false,
        collectSnapshot: jest.fn(async () => snapshot)
      }
    });
    const second = await executeResearchAttendanceTrigger({
      endpointType: 'daily',
      body: {
        target_date: '2026-07-01',
        dry_run: true,
        seed_suffix: 'batch-a'
      },
      dependencies: {
        isNonWorkingDay: () => false,
        collectSnapshot: jest.fn(async () => snapshot)
      }
    });
    const varied = await executeResearchAttendanceTrigger({
      endpointType: 'daily',
      body: {
        target_date: '2026-07-01',
        dry_run: true,
        seed_suffix: 'batch-b'
      },
      dependencies: {
        isNonWorkingDay: () => false,
        collectSnapshot: jest.fn(async () => snapshot)
      }
    });

    expect(first.seed).toBe('2026-07-01:daily:batch-a');
    expect(second.selection_summary.target_user_ids).toEqual(first.selection_summary.target_user_ids);
    expect(varied.selection_summary.target_user_ids).not.toEqual(first.selection_summary.target_user_ids);
  });

  it('builds a deterministic daily subset plan with meaningful discipline variation', async () => {
    const snapshot = createSnapshot();

    const plan = await buildResearchAttendanceTriggerPlan({
      endpointType: 'daily',
      targetDate: '2026-07-01',
      seed: '2026-07-01:daily',
      request: {
        allowNonWorkingDay: false,
        existingStrategy: 'skip',
        disciplineMix: DEFAULT_DISCIPLINE_MIX,
        seedSuffix: ''
      },
      snapshot,
      user: { id: 99, role_name: 'Admin' }
    });

    const lateRows = plan.plannedAttendanceRows.filter((row) => row.status_id === 2);
    const earlyRows = plan.plannedAttendanceRows.filter((row) => row.status_id === 4);
    const alphaRows = plan.plannedAttendanceRows.filter((row) => row.status_id === 3);

    expect(plan.population).toMatchObject({
      baseline_user_count: 52,
      eligible_user_count: 52,
      selected_user_count: 16
    });
    expect(plan.discipline_summary).toEqual({
      ontime: 12,
      late: 2,
      early: 1,
      alpha: 1
    });
    expect(lateRows).toHaveLength(2);
    expect(earlyRows).toHaveLength(1);
    expect(alphaRows).toHaveLength(1);
    expect(lateRows.every((row) => row.time_in > '2026-07-01 08:00:00')).toBe(true);
    expect(earlyRows.every((row) => Number(row.work_hour) < 8)).toBe(true);
    expect(alphaRows.every((row) => Number(row.work_hour) === 0)).toBe(true);
    expect(plan.plannedLocationEventRows).toHaveLength(30);
  });

  it('builds a deterministic full-day plan with alpha rows excluded from location events', async () => {
    const snapshot = createSnapshot();

    const plan = await buildResearchAttendanceTriggerPlan({
      endpointType: 'full-day',
      targetDate: '2026-07-01',
      seed: '2026-07-01:full-day',
      request: {
        allowNonWorkingDay: false,
        existingStrategy: 'skip',
        disciplineMix: DEFAULT_DISCIPLINE_MIX,
        seedSuffix: ''
      },
      snapshot,
      user: { id: 99, role_name: 'Admin' }
    });

    const alphaUserIds = new Set(
      plan.plannedAttendanceRows.filter((row) => row.status_id === 3).map((row) => row.user_id)
    );

    expect(plan.population).toMatchObject({
      baseline_user_count: 52,
      eligible_user_count: 52,
      selected_user_count: 52
    });
    expect(plan.discipline_summary).toEqual({
      ontime: 39,
      late: 6,
      early: 4,
      alpha: 3
    });
    expect(
      plan.plannedAttendanceRows
        .filter((row) => row.status_id === 3)
        .every(
          (row) =>
            row.time_in === row.time_out &&
            Number(row.work_hour) === 0 &&
            row.notes === RESEARCH_TRIGGER_ATTENDANCE_NOTE
        )
    ).toBe(true);
    expect(plan.plannedLocationEventRows).toHaveLength(98);
    expect(plan.plannedLocationEventRows.every((row) => !alphaUserIds.has(row.user_id))).toBe(true);
  });

  it('keeps existing rows skipped by default', async () => {
    const snapshot = createSnapshot(3, {
      baselineUsers: [
        { userId: 1, role_name: 'Employee' },
        { userId: 2, role_name: 'Employee' },
        { userId: 3, role_name: 'Employee' }
      ],
      expectedLocationsByUser: buildExpectedLocations(3),
      existingAttendanceRows: [
        {
          id_attendance: 11,
          user_id: 1,
          attendance_date: '2026-07-01',
          notes: 'Manual attendance'
        }
      ]
    });

    const plan = await buildResearchAttendanceTriggerPlan({
      endpointType: 'full-day',
      targetDate: '2026-07-01',
      seed: '2026-07-01:full-day',
      request: {
        allowNonWorkingDay: false,
        existingStrategy: 'skip',
        disciplineMix: DEFAULT_DISCIPLINE_MIX,
        seedSuffix: ''
      },
      snapshot,
      user: { id: 99, role_name: 'Admin' }
    });

    expect(plan.skipped_existing).toBe(1);
    expect(plan.plannedAttendanceRows).toHaveLength(2);
    expect(plan.replacement).toMatchObject({
      attendance: 0,
      location_events: 0
    });
  });

  it('reports replace counts and regenerates only research-owned rows when replace is requested', async () => {
    const snapshot = createSnapshot(3, {
      baselineUsers: [
        { userId: 1, role_name: 'Employee' },
        { userId: 2, role_name: 'Employee' },
        { userId: 3, role_name: 'Employee' }
      ],
      expectedLocationsByUser: buildExpectedLocations(3),
      existingAttendanceRows: [
        {
          id_attendance: 21,
          user_id: 1,
          attendance_date: '2026-07-01',
          notes: RESEARCH_TRIGGER_ATTENDANCE_NOTE
        }
      ],
      existingLocationEvents: [
        { id: 31, user_id: 1, event_timestamp: '2026-07-01 08:00:00' },
        { id: 32, user_id: 1, event_timestamp: '2026-07-01 17:00:00' }
      ]
    });

    const plan = await buildResearchAttendanceTriggerPlan({
      endpointType: 'full-day',
      targetDate: '2026-07-01',
      seed: '2026-07-01:full-day',
      request: {
        allowNonWorkingDay: false,
        existingStrategy: 'replace',
        disciplineMix: DEFAULT_DISCIPLINE_MIX,
        seedSuffix: ''
      },
      snapshot,
      user: { id: 99, role_name: 'Admin' }
    });

    expect(plan.plannedAttendanceRows).toHaveLength(3);
    expect(plan.replacement).toMatchObject({
      attendance: 1,
      location_events: 2,
      replaceableUserIds: [1]
    });
    expect(plan.warnings).toContain(
      'existing_strategy=replace akan menghapus location events existing pada level user+tanggal untuk attendance research-owned karena location_events tidak memiliki marker research-owned.'
    );
  });

  it('replace on daily regenerates from all target-date research-owned rows instead of only the new batch selection', async () => {
    const baselineSnapshot = createSnapshot();
    const batchAPlan = await buildResearchAttendanceTriggerPlan({
      endpointType: 'daily',
      targetDate: '2026-07-10',
      seed: '2026-07-10:daily:batch-a',
      request: {
        allowNonWorkingDay: false,
        existingStrategy: 'replace',
        disciplineMix: DEFAULT_DISCIPLINE_MIX,
        seedSuffix: 'batch-a'
      },
      snapshot: baselineSnapshot,
      user: { id: 99, role_name: 'Admin' }
    });

    const replaySnapshot = createSnapshot(52, {
      existingAttendanceRows: batchAPlan.plannedAttendanceRows.map((row, index) => ({
        id_attendance: index + 1,
        ...row
      })),
      existingLocationEvents: batchAPlan.plannedLocationEventRows.map((row, index) => ({
        id: index + 1,
        ...row
      }))
    });

    const batchBPlan = await buildResearchAttendanceTriggerPlan({
      endpointType: 'daily',
      targetDate: '2026-07-10',
      seed: '2026-07-10:daily:batch-b',
      request: {
        allowNonWorkingDay: false,
        existingStrategy: 'replace',
        disciplineMix: DEFAULT_DISCIPLINE_MIX,
        seedSuffix: 'batch-b'
      },
      snapshot: replaySnapshot,
      user: { id: 99, role_name: 'Admin' }
    });

    expect(batchAPlan.selection_summary.target_user_ids).toHaveLength(16);
    expect(batchBPlan.selection_summary.target_user_ids).toHaveLength(16);
    expect(batchBPlan.selection_summary.target_user_ids).not.toEqual(
      batchAPlan.selection_summary.target_user_ids
    );
    expect(batchBPlan.replacement).toMatchObject({
      attendance: batchAPlan.plannedAttendanceRows.length,
      location_events: batchAPlan.plannedLocationEventRows.length
    });
    expect(batchBPlan.plannedAttendanceRows).toHaveLength(16);
    expect(batchBPlan.plannedLocationEventRows).toHaveLength(30);
  });

  it('replace keeps non-research target-date attendance untouched with warnings', async () => {
    const snapshot = createSnapshot(52, {
      existingAttendanceRows: [
        {
          id_attendance: 1,
          user_id: 1,
          attendance_date: '2026-07-10',
          notes: RESEARCH_TRIGGER_ATTENDANCE_NOTE
        },
        {
          id_attendance: 2,
          user_id: 44,
          attendance_date: '2026-07-10',
          notes: 'Manual attendance'
        }
      ],
      existingLocationEvents: [
        { id: 1, user_id: 1, event_timestamp: '2026-07-10 08:00:00' },
        { id: 2, user_id: 1, event_timestamp: '2026-07-10 17:00:00' },
        { id: 3, user_id: 44, event_timestamp: '2026-07-10 08:00:00' }
      ]
    });

    const plan = await buildResearchAttendanceTriggerPlan({
      endpointType: 'daily',
      targetDate: '2026-07-10',
      seed: '2026-07-10:daily:batch-b',
      request: {
        allowNonWorkingDay: false,
        existingStrategy: 'replace',
        disciplineMix: DEFAULT_DISCIPLINE_MIX,
        seedSuffix: 'batch-b'
      },
      snapshot,
      user: { id: 99, role_name: 'Admin' }
    });

    expect(plan.replacement).toMatchObject({
      attendance: 1,
      location_events: 2
    });
    expect(plan.warnings).toContain(
      'existing_strategy=replace mengganti semua attendance research-owned pada tanggal target. 1 row existing non-research tetap dipertahankan dan tidak ikut direplace.'
    );
  });

  it('returns an apply response when confirmation is valid and writes succeed', async () => {
    const applyPlan = jest.fn(async () => ({
      applied_writes: {
        attendance: 2,
        bookings: 1,
        location_events: 4
      },
      replaced: {
        attendance: 1,
        location_events: 2
      }
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
          policy: {
            allow_non_working_day: false,
            existing_strategy: 'skip',
            skip_existing: true,
            discipline_mix: DEFAULT_DISCIPLINE_MIX
          },
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
          discipline_summary: { ontime: 2, late: 0, early: 0, alpha: 0 },
          warnings: [],
          conflicts: [],
          replacement: {
            attendance: 1,
            location_events: 2
          },
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
        location_events: 4
      },
      replaced: {
        attendance: 1,
        location_events: 2
      }
    });
    expect(applyPlan).toHaveBeenCalled();
  });

  it('blocks apply with an operator-friendly invalid reference error payload', async () => {
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
            policy: {
              allow_non_working_day: false,
              existing_strategy: 'skip',
              skip_existing: true,
              discipline_mix: DEFAULT_DISCIPLINE_MIX
            },
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
            discipline_summary: { ontime: 0, late: 0, early: 0, alpha: 0 },
            warnings: [],
            conflicts: [{ type: 'invalid_reference', user_id: 10, target_date: '2026-07-01', mode: 'WFA' }],
            replacement: {
              attendance: 0,
              location_events: 0
            },
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
      status: 409,
      code: 'E_INVALID_REFERENCE_STATE',
      target_date: '2026-07-01',
      endpoint_type: 'daily',
      conflicts: [{ type: 'invalid_reference', user_id: 10, target_date: '2026-07-01', mode: 'WFA' }],
      hint: 'Jalankan dry_run=true atau siapkan approved WFA booking/lokasi untuk user conflict.'
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
          policy: {
            allow_non_working_day: false,
            existing_strategy: 'skip',
            skip_existing: true,
            daily_subset_percent: 30,
            discipline_mix: DEFAULT_DISCIPLINE_MIX
          },
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
          discipline_summary: { ontime: 0, late: 0, early: 0, alpha: 0 },
          warnings: ['Semua user target sudah memiliki attendance pada tanggal yang diminta.'],
          conflicts: [],
          replacement: {
            attendance: 0,
            location_events: 0
          },
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
      would_replace: {
        attendance: 0,
        location_events: 0
      },
      skipped_existing: 2,
      warnings: ['Semua user target sudah memiliki attendance pada tanggal yang diminta.']
    });
  });
});
