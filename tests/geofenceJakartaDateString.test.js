import { jest } from '@jest/globals';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

describe('getJakartaDateString', () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.join(__dirname, '..');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns Jakarta calendar date around midnight WIB instead of UTC date', () => {
    const script = `
      const RealDate = Date;
      const fixed = new RealDate('2026-05-01T17:40:52.000Z');
      globalThis.Date = class extends RealDate {
        constructor(...args) {
          return args.length === 0 ? new RealDate(fixed) : new RealDate(...args);
        }
        static now() {
          return fixed.getTime();
        }
        static parse(value) {
          return RealDate.parse(value);
        }
        static UTC(...args) {
          return RealDate.UTC(...args);
        }
      };
      const { getJakartaDateString } = await import('./src/utils/geofence.js');
      process.stdout.write(getJakartaDateString());
    `;

    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: projectRoot,
      env: { ...process.env, TZ: 'Asia/Jakarta' },
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('2026-05-02');
  });
});
