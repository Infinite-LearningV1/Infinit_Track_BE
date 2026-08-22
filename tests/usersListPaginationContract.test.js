import { jest } from '@jest/globals';
import { Op } from 'sequelize';

/**
 * Contract tests for the INF-262 server-driven user directory
 * (INF-250 decision: server-driven, canonical envelope, phase-A additive).
 *
 * Two modes live side by side during the migration:
 * - legacy mode (no page/limit): the exact pre-INF-262 behavior — findAll,
 *   full array, no pagination object;
 * - paginated mode (page or limit present): findAndCountAll with the
 *   canonical envelope { success, data, pagination, message }.
 */

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const buildUser = (id = 1) => ({
  id_users: id,
  full_name: `User ${id}`,
  email: `user${id}@example.com`,
  nip_nim: `N${id}`,
  phone: '0812',
  role: { role_name: 'User' },
  position: { position_name: 'Engineer' },
  program: { program_name: 'Program' },
  division: { division_name: 'Division' },
  photo_file: null,
  wfh_location: {
    location_id: id,
    latitude: '-6.2',
    longitude: '106.8',
    radius: '100',
    description: null,
    attendance_category: { category_name: 'Work From Home' }
  },
  created_at: new Date('2026-07-01T00:00:00.000Z'),
  updated_at: new Date('2026-07-01T00:00:00.000Z')
});

const loadController = async ({ findAll, findAndCountAll } = {}) => {
  jest.unstable_mockModule('../src/models/index.js', () => ({
    User: {
      findAll: findAll ?? jest.fn().mockResolvedValue([]),
      findAndCountAll: findAndCountAll ?? jest.fn().mockResolvedValue({ rows: [], count: 0 })
    },
    Photo: {},
    Role: {},
    Program: {},
    Position: {},
    Division: {},
    AttendanceCategory: {},
    Location: {},
    sequelize: {}
  }));

  jest.unstable_mockModule('../src/config/spaces.js', () => ({
    buildUserProfilePhotoKey: jest.fn(),
    uploadBufferToSpaces: jest.fn(),
    deleteSpacesObject: jest.fn()
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  }));

  return import('../src/controllers/user.controller.js');
};

describe('GET /users paginated mode (INF-262)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('returns the canonical envelope when page and limit are sent', async () => {
    const findAndCountAll = jest
      .fn()
      .mockResolvedValue({ rows: [buildUser(1), buildUser(2)], count: 25 });
    const { getAllUsers } = await loadController({ findAndCountAll });

    const res = buildRes();
    await getAllUsers({ query: { page: 2, limit: 10 } }, res, jest.fn());

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data).toHaveLength(2);
    expect(payload.pagination).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });

    const options = findAndCountAll.mock.calls[0][0];
    expect(options.limit).toBe(10);
    expect(options.offset).toBe(10);
    expect(options.distinct).toBe(true);
    expect(options.subQuery).toBe(false);
  });

  test('defaults limit to 20 when only page is sent, and page to 1 when only limit is sent', async () => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    const { getAllUsers } = await loadController({ findAndCountAll });

    await getAllUsers({ query: { page: 3 } }, buildRes(), jest.fn());
    expect(findAndCountAll.mock.calls[0][0]).toMatchObject({ limit: 20, offset: 40 });

    const res = buildRes();
    await getAllUsers({ query: { limit: 5 } }, res, jest.fn());
    expect(findAndCountAll.mock.calls[1][0]).toMatchObject({ limit: 5, offset: 0 });
    expect(res.json.mock.calls[0][0].pagination.page).toBe(1);
  });

  test('a page beyond the range returns 200 with empty data and an accurate total', async () => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 5 });
    const { getAllUsers } = await loadController({ findAndCountAll });

    const res = buildRes();
    await getAllUsers({ query: { page: 99, limit: 20 } }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalledWith(404);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toEqual([]);
    expect(payload.pagination).toEqual({ page: 99, limit: 20, total: 5, totalPages: 1 });
  });

  test('paginated rows still use the slim list projection', async () => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [buildUser(1)], count: 1 });
    const { getAllUsers } = await loadController({ findAndCountAll });

    const res = buildRes();
    await getAllUsers({ query: { page: 1, limit: 20 } }, res, jest.fn());

    const row = res.json.mock.calls[0][0].data[0];
    expect(row.location_status).toBe('configured');
    expect(row).not.toHaveProperty('phone');
    expect(row).not.toHaveProperty('location');
  });
});

describe('GET /users legacy mode stays untouched (INF-250 phase A)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('without page or limit it still uses findAll and returns no pagination object', async () => {
    const findAll = jest.fn().mockResolvedValue([buildUser(1)]);
    const findAndCountAll = jest.fn();
    const { getAllUsers } = await loadController({ findAll, findAndCountAll });

    const res = buildRes();
    await getAllUsers({ query: {} }, res, jest.fn());

    expect(findAll).toHaveBeenCalledTimes(1);
    expect(findAndCountAll).not.toHaveBeenCalled();

    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toHaveLength(1);
    expect(payload).not.toHaveProperty('pagination');
  });
});

describe('GET /users filters (INF-262)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  const whereFor = async (query) => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    const { getAllUsers } = await loadController({ findAndCountAll });
    await getAllUsers({ query: { page: 1, ...query } }, buildRes(), jest.fn());
    return findAndCountAll.mock.calls[0][0].where;
  };

  test('role, program, division, and position filter by stable IDs', async () => {
    const where = await whereFor({ role: 3, program: 1, division: 2, position: 4 });
    expect(where).toMatchObject({
      id_roles: 3,
      id_programs: 1,
      id_divisions: 2,
      id_position: 4
    });
  });

  test('location_status=configured keeps only users with a WFH location', async () => {
    const where = await whereFor({ location_status: 'configured' });
    expect(where['$wfh_location.location_id$']).toEqual({ [Op.not]: null });
  });

  test('location_status=integrity_error keeps only users missing their WFH location', async () => {
    const where = await whereFor({ location_status: 'integrity_error' });
    expect(where['$wfh_location.location_id$']).toEqual({ [Op.is]: null });
  });
});

describe('GET /users search (INF-262)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  const orClauseFor = async (search) => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    const { getAllUsers } = await loadController({ findAndCountAll });
    await getAllUsers({ query: { page: 1, search } }, buildRes(), jest.fn());
    return findAndCountAll.mock.calls[0][0].where[Op.or];
  };

  test('covers full_name, nip_nim, and email', async () => {
    const orClause = await orClauseFor('nadia');
    const fields = orClause.map((clause) => Object.keys(clause)[0]);
    expect(fields).toEqual(['full_name', 'nip_nim', 'email']);
  });

  test('escapes LIKE wildcards so "50%" matches literally', async () => {
    const orClause = await orClauseFor('50%_x');
    const likeValue = orClause[0].full_name[Op.like];
    expect(likeValue).toBe('%50\\%\\_x%');
  });
});
