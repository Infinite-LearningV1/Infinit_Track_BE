import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Guards against dead controller exports (INF-252 Phase 0b).
 *
 * A controller export that no route mounts and no module imports is code that
 * still gets carried into a feature module during migration, reviewed as if it
 * were live, and maintained forever. Three concrete problems came out of the
 * audit that produced this test:
 *
 *   - booking.getMyBookings is dead, yet INF-252 Phase 4 lists "ListMyBookings"
 *     as a use case to extract. The live endpoint is /api/bookings/history via
 *     getBookingHistory. Extracting the dead one would have shipped an
 *     implementation nobody has ever run.
 *   - Two of the responses originally counted under finding F7 turned out to
 *     live in dead functions, so the security remediation scope was smaller
 *     than reported.
 *   - auth.register suggests self-registration was withdrawn without removing
 *     the handler.
 *
 * This test does not demand the dead exports be deleted -- that needs intent
 * confirmed. It pins the known set so a NEW one cannot appear unnoticed, and
 * so the list shrinks visibly as they are removed.
 */

const CONTROLLER_DIR = path.join(process.cwd(), 'src', 'controllers');
const SRC_DIR = path.join(process.cwd(), 'src');

/**
 * Known unreachable exports as of 2026-07-26. Recorded as finding F19.
 * Remove entries here when the corresponding export is deleted.
 */
const KNOWN_UNREACHABLE = [
  'attendance.controller.js::testTimezone',
  'auth.controller.js::register',
  'booking.controller.js::getMyBookings',
  'user.controller.js::getProfile',
  'user.controller.js::updateProfile'
];

const collectJsFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJsFiles(full));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.cjs')) out.push(full);
  }
  return out;
};

const findUnreachableExports = () => {
  const controllerFiles = readdirSync(CONTROLLER_DIR).filter((f) => f.endsWith('.controller.js'));
  const allSources = collectJsFiles(SRC_DIR).map((file) => ({
    file,
    text: readFileSync(file, 'utf8')
  }));

  const unreachable = [];

  for (const controllerFile of controllerFiles) {
    const controllerPath = path.join(CONTROLLER_DIR, controllerFile);
    const text = readFileSync(controllerPath, 'utf8');
    const exportNames = [...text.matchAll(/^export const ([a-zA-Z_$][\w$]*)/gm)].map((m) => m[1]);

    for (const name of exportNames) {
      const referencedElsewhere = allSources.some(
        ({ file, text: body }) =>
          file !== controllerPath && new RegExp(`\\b${name}\\b`).test(body)
      );
      if (!referencedElsewhere) {
        unreachable.push(`${controllerFile}::${name}`);
      }
    }
  }

  return unreachable.sort();
};

describe('controller export reachability', () => {
  it('has no unreachable export beyond the recorded set', () => {
    const unreachable = findUnreachableExports();
    const unexpected = unreachable.filter((entry) => !KNOWN_UNREACHABLE.includes(entry));

    expect(unexpected).toEqual([]);
  });

  it('still lists every recorded dead export, so the list shrinks visibly when one is removed', () => {
    const unreachable = findUnreachableExports();
    const alreadyRemoved = KNOWN_UNREACHABLE.filter((entry) => !unreachable.includes(entry));

    // If this fails, a dead export was deleted -- good. Drop it from
    // KNOWN_UNREACHABLE in the same commit.
    expect(alreadyRemoved).toEqual([]);
  });

  it('confirms the live bookings listing is getBookingHistory, not getMyBookings', () => {
    const routes = readFileSync(path.join(SRC_DIR, 'routes', 'booking.routes.js'), 'utf8');

    expect(routes).toContain('getBookingHistory');
    expect(routes).not.toContain('getMyBookings');
  });
});
