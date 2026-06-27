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
