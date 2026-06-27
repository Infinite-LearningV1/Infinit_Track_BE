
import {
  APPLY_ACK_FLAG,
  BLACKOUT_MONTHS,
  FIXED_OUTPUT_PATH,
  RESEARCH_ATTENDANCE_CONFIG
} from '../scripts/research/research-attendance-config.js';
import {
  createSeededNumberStream,
  parseArgs
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
