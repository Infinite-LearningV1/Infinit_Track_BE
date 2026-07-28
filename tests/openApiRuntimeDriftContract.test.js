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
 * INF-267 resolved the attendance half (F36): the public contract now matches
 * the validated query matrix and audit list envelope. The attendance block
 * below protects that closure while F39 deliberately retains its legacy
 * pagination key spelling.
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
   * F35 resolved (INF-251/INF-261), then INF-262 implemented the INF-250
   * server-driven matrix. The spec documents exactly the parameters the
   * controller now reads — and still not the phantom role_id/division_id
   * spellings from the pre-audit spec.
   */
  it.each([['role_id'], ['division_id']])(
    'still does not document the phantom "%s" parameter',
    (param) => {
      expect(block).not.toContain(`name: ${param}`);
    }
  );

  it.each([
    ['page'],
    ['limit'],
    ['search'],
    ['role'],
    ['program'],
    ['division'],
    ['position'],
    ['location_status'],
    ['sortBy'],
    ['sortOrder']
  ])('documents the "%s" query parameter the controller reads (INF-250 matrix)', (param) => {
    expect(block).toContain(`name: ${param}`);
  });

  it('describes search as covering full name, NIP/NIM, and email, matching the controller', () => {
    expect(block).toMatch(/Search by full name, NIP\/NIM, or email/);
  });

  /**
   * The runtime answers { success, data: [...], message }, plus a canonical
   * pagination sibling in opt-in paginated mode (INF-262). The spec documents
   * that envelope with the slim UserListItem projection.
   */
  it('documents data as an array of UserListItem with the canonical pagination sibling', () => {
    expect(block).toContain("$ref: '#/components/schemas/UserListItem'");
    expect(block).not.toContain('users:');
    expect(block).toContain('pagination:');
    expect(block).toContain('totalPages:');
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

  it.each([['date'], ['user_id']])(
    'does not document the removed "%s" parameter',
    (param) => {
      expect(block).not.toContain(`name: ${param}`);
    }
  );

  it.each([
    ['page'],
    ['limit'],
    ['search'],
    ['from'],
    ['to'],
    ['mode'],
    ['status'],
    ['checkout_state'],
    ['sortBy'],
    ['sortOrder']
  ])('documents the validated "%s" query parameter', (param) => {
    expect(block).toContain(`name: ${param}`);
  });

  it('describes search as covering full name, NIP/NIM, and email', () => {
    expect(block).toMatch(/full name, NIP\/NIM, and email/);
  });

  it('documents the flat audit-list data and sibling pagination envelope', () => {
    expect(block).toContain("$ref: '#/components/schemas/AttendanceAuditListRow'");
    expect(block).toContain('pagination:');
    expect(block).not.toContain('attendances:');
  });
});

describe('the two list endpoints disagree with each other', () => {
  /**
   * Both admin lists now paginate, but the envelopes are spelled differently:
   * users adopted the INF-250 canonical spelling (page/limit/total/totalPages,
   * F20 closed by INF-262) while attendance still uses total_records /
   * records_per_page (F39). Migrating attendance to the canonical spelling is
   * follow-up scope; until then this pin keeps the difference visible.
   */
  it('users documents the canonical envelope while attendance keeps the legacy spelling', () => {
    const users = operationBlock('/api/users', 'get');
    const attendance = operationBlock('/api/attendance', 'get');

    expect(users).toContain('totalPages:');
    expect(users).toContain('name: page');
    expect(users).toContain('name: limit');
    expect(users).not.toContain('total_records');

    expect(attendance).toContain('pagination:');
    expect(attendance).toContain('name: page');
    expect(attendance).toContain('name: limit');
    expect(attendance).not.toContain('totalPages:');
  });
});
