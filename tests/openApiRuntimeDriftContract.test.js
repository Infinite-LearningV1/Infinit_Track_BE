import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Pins the drift between docs/openapi.yaml and verified runtime behavior
 * (INF-252 Phase 0, follow-up audit).
 *
 * The structural audit is clean: 62 mounted operations, 50 documented, and
 * every undocumented one appears on the deliberate exclusion list that
 * openApiMountedRoutesContract.test.js already enforces. No phantom paths.
 *
 * The *contract* audit is not clean. Both list endpoints document a response
 * shape the runtime does not produce, and both document query parameters the
 * controllers ignore. A client written literally against the spec would read
 * `response.data.users` and get undefined.
 *
 * These assertions describe the mismatch as it stands today. They are
 * characterization, not approval -- see F35 and F36 in
 * docs/architecture/api-contract-inventory.md. Whichever way INF-250 resolves
 * the user-directory contract, this file has to be updated deliberately.
 */

const spec = readFileSync(path.join(process.cwd(), 'docs', 'openapi.yaml'), 'utf8');

/** Returns the raw YAML block for one path+method, without a YAML parser. */
const operationBlock = (apiPath, method) => {
  const lines = spec.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `${apiPath}:` && l.startsWith('  /'));
  if (start === -1) return '';

  const out = [];
  let inMethod = false;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^ {2}\//.test(line)) break;
    if (new RegExp(`^ {4}${method}:\\s*$`).test(line)) {
      inMethod = true;
      continue;
    }
    if (inMethod && /^ {4}\w+:\s*$/.test(line)) break;
    if (inMethod) out.push(line);
  }
  return out.join('\n');
};

describe('GET /api/users — documented contract versus runtime', () => {
  const block = operationBlock('/api/users', 'get');

  it('is documented at all', () => {
    expect(block).not.toHaveLength(0);
  });

  /**
   * F35. usersPayloadContract.test.js pins the runtime as accepting
   * search, sortBy and sortOrder, with no pagination whatsoever (F20).
   */
  it.each([['page'], ['limit'], ['role_id'], ['division_id']])(
    'documents a "%s" query parameter the controller ignores',
    (param) => {
      expect(block).toContain(`name: ${param}`);
    }
  );

  it('does not document sortBy or sortOrder, which the controller does read', () => {
    expect(block).not.toContain('name: sortBy');
    expect(block).not.toContain('name: sortOrder');
  });

  it('describes search as covering email, though the controller searches nip_nim', () => {
    expect(block).toMatch(/Search by name or email/);
  });

  /**
   * The runtime answers { success, data: [...], message }. The spec describes
   * data as an object wrapping `users` and `pagination`.
   */
  it('documents data as an object wrapping users and pagination', () => {
    expect(block).toContain('users:');
    expect(block).toContain('pagination:');
  });

  it('does not document the message field the controller always returns', () => {
    expect(block).not.toContain('message:');
  });
});

describe('GET /api/attendance — documented contract versus runtime', () => {
  const block = operationBlock('/api/attendance', 'get');

  it('is documented at all', () => {
    expect(block).not.toHaveLength(0);
  });

  /**
   * F36. attendanceReadsContract.test.js pins the runtime as accepting
   * search, page and limit only.
   */
  it.each([['date'], ['user_id']])(
    'documents a "%s" filter the controller ignores',
    (param) => {
      expect(block).toContain(`name: ${param}`);
    }
  );

  it('documents page and limit, which this controller genuinely honours', () => {
    expect(block).toContain('name: page');
    expect(block).toContain('name: limit');
  });

  it('describes search as covering email, though the controller searches nip_nim', () => {
    expect(block).toMatch(/Search by user name or email/);
  });

  /**
   * The runtime answers { success, message, data: [...], pagination: {...} }
   * with pagination a SIBLING of data. The spec nests both inside data.
   */
  it('nests attendances and pagination inside data, unlike the runtime', () => {
    expect(block).toContain('attendances:');
    expect(block).toContain('pagination:');
  });
});

describe('the two list endpoints disagree with each other', () => {
  /**
   * Worth stating on its own: the runtime shapes differ between the two
   * admin lists -- attendance paginates, users does not (F20) -- while the
   * spec describes them identically. Phase 2's list-query foundation has to
   * pick one, and the spec currently matches neither.
   */
  it('are documented with the same envelope despite behaving differently', () => {
    const users = operationBlock('/api/users', 'get');
    const attendance = operationBlock('/api/attendance', 'get');

    for (const block of [users, attendance]) {
      expect(block).toContain('pagination:');
      expect(block).toContain('name: page');
      expect(block).toContain('name: limit');
    }
  });
});
