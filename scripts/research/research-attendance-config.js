import path from 'path';

export const APPLY_ACK_FLAG = '--i-understand-this-writes-attendance-data';
export const BLACKOUT_MONTHS = Object.freeze(['2025-12', '2026-05']);
export const FIXED_OUTPUT_PATH = path.join(
  process.cwd(),
  'scripts',
  'research',
  'output',
  'attendance-dataset-dry-run.json'
);

export const RESEARCH_ATTENDANCE_CONFIG = Object.freeze({
  seed: 'INF-181-ATTENDANCE-RESEARCH',
  dateRange: {
    start: '2025-07-01',
    end: '2026-06-26'
  },
  blockedDate: '2026-06-27',
  blackoutMonths: BLACKOUT_MONTHS,
  monthlyStatusTargets: Object.freeze({
    '2025-08': { ontime: 95, late: 4, alpha: 1, early: 0 },
    '2025-09': { ontime: 94, late: 2, alpha: 1, early: 3 },
    '2025-10': { ontime: 90, late: 6, alpha: 2, early: 2 },
    '2025-11': { ontime: 97, late: 3, alpha: 0, early: 0 },
    '2026-01': { ontime: 90, late: 7, alpha: 0, early: 3 },
    '2026-02': { ontime: 99, late: 0, alpha: 0, early: 1 },
    '2026-03': { ontime: 95, late: 0, alpha: 0, early: 5 },
    '2026-04': { ontime: 93, late: 1, alpha: 4, early: 2 },
    '2026-06': { ontime: 89, late: 1, alpha: 5, early: 5 }
  }),
  monthlyModeTargets: Object.freeze({
    '2025-08': { wfo: 95, wfh: 5, wfa: 0 },
    '2025-09': { wfo: 93, wfh: 5, wfa: 2 },
    '2025-10': { wfo: 90, wfh: 7, wfa: 3 },
    '2025-11': { wfo: 87, wfh: 8, wfa: 5 },
    '2026-01': { wfo: 88, wfh: 2, wfa: 10 },
    '2026-02': { wfo: 97, wfh: 3, wfa: 0 },
    '2026-03': { wfo: 98, wfh: 2, wfa: 0 },
    '2026-04': { wfo: 91, wfh: 4, wfa: 5 },
    '2026-06': { wfo: 91, wfh: 3, wfa: 6 }
  }),
  monthlyGeofenceTargets: Object.freeze({
    '2025-08': { full: 82, partial: 13, missing: 5 },
    '2025-09': { full: 84, partial: 12, missing: 4 },
    '2025-10': { full: 87, partial: 10, missing: 3 },
    '2025-11': { full: 90, partial: 8, missing: 2 },
    '2026-01': { full: 85, partial: 11, missing: 4 },
    '2026-02': { full: 93, partial: 6, missing: 1 },
    '2026-03': { full: 94, partial: 5, missing: 1 },
    '2026-04': { full: 88, partial: 9, missing: 3 },
    '2026-06': { full: 86, partial: 10, missing: 4 }
  }),
  notes: Object.freeze([
    'Kehadiran tercatat dari lokasi kerja.',
    'Keterlambatan tercatat pada saat check-in.',
    'Kehadiran WFH tercatat sesuai jadwal kerja.',
    'Kehadiran WFA tercatat sesuai lokasi yang disetujui.',
    'Tidak ada aktivitas kehadiran pada jadwal kerja.',
    'Check-in lebih awal dari jadwal kerja.',
    'Data lokasi tercatat sebagian pada hari kerja.'
  ])
});
