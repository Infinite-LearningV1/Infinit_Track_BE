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
 * The *contract* audit had two halves.
 *
 * The users half (F35) was resolved by INF-251/INF-261: docs/openapi.yaml now
 * documents the real runtime query parameters (search/sortBy/sortOrder), the
 * real envelope (data as an array plus message), and the new slim UserListItem
 * projection. The /api/users block below asserts the spec STAYS aligned.
 *
 * The attendance half (F36) is still drifted and still pinned as-is; whichever
 * way INF-250 resolves the attendance list contract, that block has to be
 * updated deliberately. See docs/architecture/api-contract-inventory.md.
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
   * F35 resolved (INF-251/INF-261). usersPayloadContract.test.js pins the
   * runtime as accepting search, sortBy and sortOrder, with no pagination
   * whatsoever (F20) — and the spec now says exactly that.
   */
  it.each([['page'], ['limit'], ['role_id'], ['division_id']])(
    'no longer documents the "%s" query parameter the controller ignores',
    (param) => {
      expect(block).not.toContain(`name: ${param}`);
    }
  );

  it.each([['search'], ['sortBy'], ['sortOrder']])(
    'documents the "%s" query parameter the controller reads',
    (param) => {
      expect(block).toContain(`name: ${param}`);
    }
  );

  it('describes search as covering full name and NIP/NIM, matching the controller', () => {
    expect(block).toMatch(/Search by full name or NIP\/NIM/);
  });

  /**
   * The runtime answers { success, data: [...], message } and the spec now
   * documents that envelope with the slim UserListItem projection.
   */
  it('documents data as an array of UserListItem with no pagination wrapper', () => {
    expect(block).toContain("$ref: '#/components/schemas/UserListItem'");
    expect(block).not.toContain('users:');
    expect(block).not.toContain('pagination:');
  });

  it('documents the message field the controller always returns', () => {
    expect(block).toContain('message:');
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
   * The runtime shapes differ between the two admin lists -- attendance
   * paginates, users does not (F20). Since INF-251/INF-261 the users spec
   * matches its runtime; the attendance spec is still the drifted shape.
   * Phase 2's list-query foundation (INF-250) still has to unify the two
   * runtime contracts themselves.
   */
  it('users is documented without pagination while attendance still documents it', () => {
    const users = operationBlock('/api/users', 'get');
    const attendance = operationBlock('/api/attendance', 'get');

    expect(users).not.toContain('pagination:');
    expect(users).not.toContain('name: page');
    expect(users).not.toContain('name: limit');

    expect(attendance).toContain('pagination:');
    expect(attendance).toContain('name: page');
    expect(attendance).toContain('name: limit');
  });
});
