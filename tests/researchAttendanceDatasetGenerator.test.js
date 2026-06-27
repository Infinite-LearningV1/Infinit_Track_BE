
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import Holidays from 'date-holidays';

import {
  APPLY_ACK_FLAG,
  BLACKOUT_MONTHS,
  FIXED_OUTPUT_PATH,
  RESEARCH_ATTENDANCE_CONFIG
} from '../scripts/research/research-attendance-config.js';
import {
  buildDryRunSummary,
  buildResearchAttendancePlan,
  buildWorkingDates,
  createSeededNumberStream,
  formatDryRunReport,
  parseArgs,
  writeSummaryArtifact
} from '../scripts/research/generate-attendance-dataset.js';

describe('research attendance generator scaffold contract', () => {
  it('uses dry-run defaults and the fixed JSON output path', () => {
    expect(parseArgs([])).toEqual({
      apply: false,
      acknowledged: false,
      dryRun: true,
      outputPath: FIXED_OUTPUT_PATH
    });
  });

  it('detects apply mode only when the acknowledge flag is present', () => {
    expect(parseArgs(['--apply'])).toEqual({
      apply: true,
      acknowledged: false,
      dryRun: false,
      outputPath: FIXED_OUTPUT_PATH
    });

    expect(parseArgs(['--apply', APPLY_ACK_FLAG])).toEqual({
      apply: true,
      acknowledged: true,
      dryRun: false,
      outputPath: FIXED_OUTPUT_PATH
    });
  });

  it('keeps the research config deterministic and aligned with the spec', () => {
    expect(RESEARCH_ATTENDANCE_CONFIG.seed).toBe('INF-181-ATTENDANCE-RESEARCH');
    expect(BLACKOUT_MONTHS).toEqual(['2025-12', '2026-05']);
    expect(RESEARCH_ATTENDANCE_CONFIG.dateRange).toEqual({
      start: '2025-07-01',
      end: '2026-06-26'
    });
  });

  it('produces a stable seeded number stream', () => {
    const left = createSeededNumberStream('INF-181-ATTENDANCE-RESEARCH');
    const right = createSeededNumberStream('INF-181-ATTENDANCE-RESEARCH');

    expect([left(), left(), left()]).toEqual([right(), right(), right()]);
  });
});

const noHolidayCalendar = {
  isHoliday(date) {
    const hd = new Holidays('ID');
    return hd.isHoliday(date);
  }
};

describe('research attendance planner', () => {
  it('excludes weekends, blackout months, and the blocked date', () => {
    const workingDates = buildWorkingDates({
      start: '2026-05-29',
      end: '2026-06-27',
      blackoutMonths: ['2026-05'],
      blockedDate: '2026-06-27',
      holidays: noHolidayCalendar
    });

    expect(workingDates).not.toContain('2026-05-29');
    expect(workingDates).not.toContain('2026-06-27');
    expect(workingDates.every((date) => !date.startsWith('2026-05'))).toBe(true);
  });

  it('skips existing attendance rows and keeps immutable months best-effort', () => {
    const plan = buildResearchAttendancePlan({
      config: RESEARCH_ATTENDANCE_CONFIG,
      baselineUsers: [{ userId: 10 }, { userId: 11 }],
      existingAttendanceRows: [
        { user_id: 10, attendance_date: '2025-08-01', status_id: 1, category_id: 1, booking_id: null }
      ],
      existingBookingRows: [],
      existingLocationEvents: [],
      expectedLocationsByUser: {
        10: { wfoLocationId: 101, wfhLocationId: 201, fallbackWfaLocationId: 301 },
        11: { wfoLocationId: 102, wfhLocationId: 202, fallbackWfaLocationId: 302 }
      },
      holidays: { isHoliday: () => false }
    });

    expect(plan.existingSkipped).toBeGreaterThan(0);
    expect(
      plan.plannedAttendanceRows.find(
        (row) => row.user_id === 10 && row.attendance_date === '2025-08-01'
      )
    ).toBeUndefined();
    expect(plan.monthlySummaries['2025-08']).toEqual(
      expect.objectContaining({ immutableMonth: true })
    );
  });

  it('forces alpha rows to use zero work_hour and no location events', () => {
    const plan = buildResearchAttendancePlan({
      config: {
        ...RESEARCH_ATTENDANCE_CONFIG,
        dateRange: { start: '2026-04-01', end: '2026-04-01' },
        monthlyStatusTargets: { '2026-04': { ontime: 0, late: 0, alpha: 100, early: 0 } },
        monthlyModeTargets: { '2026-04': { wfo: 100, wfh: 0, wfa: 0 } },
        monthlyGeofenceTargets: { '2026-04': { full: 0, partial: 0, missing: 100 } }
      },
      baselineUsers: [{ userId: 50 }],
      existingAttendanceRows: [],
      existingBookingRows: [],
      existingLocationEvents: [],
      expectedLocationsByUser: { 50: { wfoLocationId: 500 } },
      holidays: { isHoliday: () => false }
    });

    expect(plan.plannedAttendanceRows[0]).toEqual(
      expect.objectContaining({ status_id: 3, work_hour: 0 })
    );
    expect(plan.plannedLocationEventRows).toHaveLength(0);
  });

  it('creates approved booking rows for planned WFA attendance', () => {
    const plan = buildResearchAttendancePlan({
      config: {
        ...RESEARCH_ATTENDANCE_CONFIG,
        dateRange: { start: '2026-01-02', end: '2026-01-02' },
        monthlyStatusTargets: { '2026-01': { ontime: 100, late: 0, alpha: 0, early: 0 } },
        monthlyModeTargets: { '2026-01': { wfo: 0, wfh: 0, wfa: 100 } },
        monthlyGeofenceTargets: { '2026-01': { full: 100, partial: 0, missing: 0 } }
      },
      baselineUsers: [{ userId: 77 }],
      existingAttendanceRows: [],
      existingBookingRows: [],
      existingLocationEvents: [],
      expectedLocationsByUser: { 77: { fallbackWfaLocationId: 707 } },
      holidays: { isHoliday: () => false }
    });

    expect(plan.plannedAttendanceRows[0].category_id).toBe(3);
    expect(plan.plannedBookingRows).toEqual([
      expect.objectContaining({ user_id: 77, schedule_date: '2026-01-02', status: 1, location_id: 707 })
    ]);
  });
});

describe('dry-run summary output', () => {
  it('writes a machine-readable JSON summary to the fixed path shape', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inf-181-'));
    const outputPath = path.join(tmpDir, 'attendance-dataset-dry-run.json');
    const summary = buildDryRunSummary({
      args: { apply: false, dryRun: true },
      snapshot: { dbIdentity: { host: '127.0.0.1', port: 3306, database: 'v1_infinite_track' }, lookupValidation: { ok: true } },
      plan: {
        population: { source: 'existing July 2025 attendance baseline', count: 2 },
        calendar: { workingDates: ['2026-01-02'] },
        existingSkipped: 1,
        plannedAttendanceRows: [{ user_id: 1, attendance_date: '2026-01-02' }],
        plannedBookingRows: [],
        plannedLocationEventRows: [],
        monthlySummaries: { '2026-01': { immutableMonth: false } },
        potentialConflicts: [],
        needsVerification: []
      }
    });

    const writtenPath = await writeSummaryArtifact(summary, outputPath);
    const raw = await fs.readFile(writtenPath, 'utf8');
    const parsed = JSON.parse(raw);

    expect(writtenPath).toBe(outputPath);
    expect(parsed.dbIdentity).toEqual({ host: '127.0.0.1', port: 3306, database: 'v1_infinite_track' });
    expect(parsed.plannedWrites.attendance).toBe(1);
  });

  it('formats the dry-run report with db identity and write counts', () => {
    const report = formatDryRunReport({
      dbIdentity: { host: '127.0.0.1', port: 3306, database: 'v1_infinite_track' },
      population: { source: 'existing July 2025 attendance baseline', count: 2 },
      blackoutMonths: ['2025-12', '2026-05'],
      existingSkipped: 3,
      plannedWrites: { attendance: 4, bookings: 1, locationEvents: 6 },
      potentialConflicts: [],
      needsVerification: []
    });

    expect(report).toContain('DB host: 127.0.0.1');
    expect(report).toContain('planned attendance writes: 4');
    expect(report).toContain('planned booking writes: 1');
    expect(report).toContain('planned location_event writes: 6');
  });
});
