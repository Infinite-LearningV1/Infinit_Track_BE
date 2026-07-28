import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Keeps the findings register honest.
 *
 * `docs/architecture/api-contract-inventory.md` now drives Phases 2 through 8.
 * A finding that quietly stops being true — because the code was fixed, or
 * because it was mis-stated in the first place — sends real work in the wrong
 * direction.
 *
 * This file re-checks the premises that can be verified mechanically. It is
 * not a substitute for reading the register; it is a tripwire for the subset
 * that a script can confirm.
 *
 * It exists because the register has already been wrong twice: F7's count was
 * corrected from 13 to 6 and then to 3, and F13 claimed "zero createTable
 * calls" when there are two.
 */

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const SRC = (rel) => read(path.join('src', rel));

describe('F1 — the 404 handler breaks the envelope convention', () => {
  it('still answers with a bare message and no success flag', () => {
    const routes = SRC('routes/index.js');
    expect(routes).toContain("res.status(404).json({ message: 'Route not found' })");
  });
});

describe('F2 / F3 — searchHelper mutates and does not escape', () => {
  const helper = SRC('utils/searchHelper.js');

  it('still assigns into the caller-supplied options', () => {
    expect(helper).toMatch(/queryOptions\.where\s*=/);
  });

  it('still interpolates the term without escaping LIKE metacharacters', () => {
    expect(helper).toContain('`%${searchTerm.trim()}%`');
    expect(helper).not.toMatch(/replace\([^)]*%[^)]*\)/);
  });
});

describe('F4 — contribution.routes.js is dead', () => {
  it('still registers no route', () => {
    const file = SRC('routes/contribution.routes.js');
    expect(/^\s*router\.(get|post|put|patch|delete)\(/m.test(file)).toBe(false);
  });

  it('is still not mounted', () => {
    expect(SRC('routes/index.js')).not.toContain('contribution.routes.js');
  });
});

describe('F7 — reachable 5xx responses that leak error text', () => {
  /**
   * The count reached 3 only after two corrections: the first version counted
   * logger metadata, the second ignored reachability. If this number moves,
   * the register needs revisiting rather than the test relaxing.
   */
  /** Every non-controller source file, for reachability checks. */
  const allSources = ['controllers', 'services', 'jobs', 'utils', 'routes', 'middlewares'].flatMap(
    (dir) =>
      readdirSync(path.join(process.cwd(), 'src', dir))
        .filter((f) => f.endsWith('.js'))
        .map((f) => ({ id: `${dir}/${f}`, body: SRC(path.join(dir, f)) }))
  );

  const enclosingExport = (lines, index) => {
    for (let i = index; i >= 0; i -= 1) {
      const m = /^export const (\w+)\s*=/.exec(lines[i]);
      if (m) return m[1];
    }
    return null;
  };

  const isReachable = (file, name) =>
    allSources.some((s) => s.id !== `controllers/${file}` && new RegExp(`\\b${name}\\b`).test(s.body));

  it('finds six 5xx leaks in total, of which exactly three are reachable', () => {
    const controllers = readdirSync(path.join(process.cwd(), 'src', 'controllers')).filter((f) =>
      f.endsWith('.controller.js')
    );

    const all = [];
    for (const file of controllers) {
      const lines = SRC(path.join('controllers', file)).split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/error:\s*(error|err)\.message/.test(line)) return;
        const context = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
        if (!/res\.status\(5\d\d\)/.test(context)) return;
        all.push({ file, line: i + 1, fn: enclosingExport(lines, i) });
      });
    }

    // The raw pattern match is what the first two corrections stopped at.
    expect(all).toHaveLength(6);

    // Reachability is what brings it to three -- the step the second
    // correction was missing.
    const reachable = all.filter((l) => isReachable(l.file, l.fn));
    expect(reachable).toHaveLength(3);
    expect(reachable.every((l) => l.file === 'attendance.controller.js')).toBe(true);

    const dead = all.filter((l) => !isReachable(l.file, l.fn)).map((l) => l.fn).sort();
    expect(dead).toEqual(['getProfile', 'testTimezone', 'updateProfile']);
  });
});

describe('F13 — the schema cannot be built from migrations', () => {
  const migrationsDir = path.join(process.cwd(), 'src', 'models', 'migrations');
  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.cjs'));

  /**
   * The original wording claimed zero createTable calls. There are now three migrations
   * with createTable calls, all from 2026. The conclusion is unchanged -- an empty database
   * still cannot be built -- but the evidence had to be corrected, and this
   * pins the corrected version.
   */
  it('creates tables only in the known 2026 migrations', () => {
    const creating = migrations.filter((f) =>
      readFileSync(path.join(migrationsDir, f), 'utf8').includes('createTable')
    );

    expect(creating.sort()).toEqual([
      '20260511000000-create-auth-sessions.cjs',
      '20260707010000-create-attendance-session-states.cjs',
      '20260728010000-add-wfa-request-policy.cjs'
    ]);
  });

  it('leaves every core table to the baseline', () => {
    const modelled = new Set(
      readdirSync(path.join(process.cwd(), 'src', 'models'))
        .filter((f) => f.endsWith('.model.js'))
        .flatMap((f) => [...SRC(path.join('models', f)).matchAll(/tableName: '([a-z_]+)'/g)])
        .map((m) => m[1])
    );

    const created = new Set([
      'auth_sessions',
      'attendance_session_states',
      'wfa_request_reasons',
      'wfa_rejection_reasons'
    ]);
    const fromBaselineOnly = [...modelled].filter((t) => !created.has(t));

    // Includes users, attendance, bookings, locations — the entire core.
    expect(fromBaselineOnly).toContain('users');
    expect(fromBaselineOnly).toContain('attendance');
    expect(fromBaselineOnly.length).toBeGreaterThanOrEqual(14);
  });

  it('still has the historical alignment stub that documents why', () => {
    const stub = readFileSync(
      path.join(migrationsDir, '20240525120000-create-user.cjs'),
      'utf8'
    );
    expect(stub).toContain('the users table already exists in the baseline schema');
  });
});

describe('F16 — the EARLY status is unreachable', () => {
  it('still gates on the same condition the classifier tests', () => {
    const body = SRC('controllers/attendance.controller.js');
    expect(body).toContain('currentTimeMinutes < checkinStartMinutes || currentTimeMinutes > checkinEndMinutes');
    expect(body).toMatch(/if \(currentTimeMinutes < checkinStartMinutes\) \{[\s\S]{0,120}determinedStatusId = 4/);
  });
});

describe('F20 — GET /api/users pagination (CLOSED by INF-262)', () => {
  /**
   * F20 recorded the absence of pagination. INF-262 (INF-250 decision) closed
   * it with opt-in pagination: page/limit trigger findAndCountAll with the
   * canonical envelope, while their absence preserves the legacy full-array
   * response (phase A of the migration plan). This guard now protects the
   * closure: both modes must remain present until phase C retires legacy.
   */
  it('reads page and limit, paginates via findAndCountAll, and keeps the legacy findAll path', () => {
    const body = SRC('controllers/user.controller.js');
    const listSection = body.slice(body.indexOf('export const getAllUsers'), body.indexOf('export const uploadUserPhoto'));

    expect(listSection).toMatch(/const \{ search, role, program, division, position \} = req\.query/);
    expect(listSection).toMatch(/req\.query\.page/);
    expect(listSection).toMatch(/req\.query\.limit/);
    expect(listSection).toContain('findAndCountAll');
    expect(listSection).toContain('User.findAll');
  });
});

describe('F24 — attendance is hard-deleted', () => {
  it('model still declares neither paranoid nor deleted_at', () => {
    const model = SRC('models/attendance.model.js');
    expect(model).not.toContain('paranoid');
    expect(model).not.toContain('deleted_at');
  });
});

describe('F26 — updateUser has no transaction', () => {
  it('still opens none', () => {
    const body = SRC('controllers/user.controller.js');
    const section = body.slice(body.indexOf('export const updateUser'), body.indexOf('export const deleteUser'));
    expect(section).not.toContain('transaction');
  });
});

describe('F29 — the strict date validator exists and is not used', () => {
  it('the operational triggers still hand-roll a shape check', () => {
    expect(SRC('controllers/attendance.controller.js')).toContain('/^\\d{4}-\\d{2}-\\d{2}$/');
  });

  it('while parseIsoDateUtcStrict is available and used elsewhere', () => {
    expect(SRC('utils/isoDate.js')).toContain('export const parseIsoDateUtcStrict');
    expect(SRC('utils/historicalDateWindow.js')).toContain('parseIsoDateUtcStrict');
    expect(SRC('controllers/attendance.controller.js')).not.toContain('parseIsoDateUtcStrict');
  });
});

describe('F38 — applyMultipleSearch is unused', () => {
  it('is still exported and still called nowhere in src', () => {
    expect(SRC('utils/searchHelper.js')).toContain('export const applyMultipleSearch');

    const callers = ['controllers', 'services', 'jobs', 'utils'].flatMap((dir) =>
      readdirSync(path.join(process.cwd(), 'src', dir))
        .filter((f) => f.endsWith('.js') && f !== 'searchHelper.js')
        .filter((f) => SRC(path.join(dir, f)).includes('applyMultipleSearch'))
    );

    expect(callers).toEqual([]);
  });
});

describe('F39 — the two paginated lists disagree on key names', () => {
  it('attendance still says records_per_page', () => {
    expect(SRC('controllers/attendance.controller.js')).toContain('records_per_page');
  });

  it('summary still says items_per_page', () => {
    expect(SRC('services/summaryReport.service.js')).toContain('items_per_page');
  });
});

describe('F40 — the flagger logs a field that does not exist', () => {
  it('still references attendance_id where the key is id_attendance', () => {
    expect(SRC('jobs/autoCheckout.job.js')).toContain('attendance.attendance_id');
    expect(SRC('models/attendance.model.js')).toContain('id_attendance');
  });
});

describe('F44 — the job timeout does not cancel', () => {
  it('still races without any cancellation mechanism', () => {
    const helper = SRC('utils/jobHelper.js');
    expect(helper).toContain('Promise.race');
    expect(helper).not.toContain('AbortController');
    expect(helper).toContain('was terminated');
  });
});
