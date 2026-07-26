import { jest } from '@jest/globals';

/**
 * Characterization coverage for the Users read and delete payloads
 * (INF-252 Phase 0b).
 *
 * usersRouteContract.test.js pins the middleware chain and the validation
 * rules. This file pins what the controllers themselves return -- the mapped
 * user shape, the soft-delete filter, the search predicate, and the 404
 * semantics. Users is the first module scheduled for extraction in Phase 3,
 * so these are the payloads the migration has to preserve exactly.
 *
 * createUser and updateUser are deliberately out of scope here: both go
 * through DigitalOcean Spaces uploads and transaction orchestration and
 * deserve their own slice.
 */

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

/** A Sequelize-shaped row with every association populated. */
const fullUserRow = (overrides = {}) => ({
  id_users: 7,
  full_name: 'Nadia Putri',
  email: 'nadia@example.com',
  nip_nim: 'A12345',
  phone: '081234567890',
  role: { role_name: 'User' },
  position: { position_name: 'Backend Engineer' },
  program: { program_name: 'Internship' },
  division: { division_name: 'Engineering' },
  photo_file: { photo_url: 'https://cdn.example/nadia.jpg', photo_updated_at: '2026-07-01' },
  wfh_location: {
    location_id: 12,
    latitude: '-0.8917',
    longitude: '119.8707',
    radius: '150',
    description: 'Rumah Nadia',
    attendance_category: { category_name: 'Work From Home' }
  },
  ...overrides
});

/**
 * getUserById queries with findOne (filtering deleted_at in the where clause)
 * while deleteUser uses findByPk and checks deleted_at afterwards. The helper
 * exposes both so each test targets the right one.
 */
const loadUsers = async ({ findAll = [], findByPk = null, findOne = null, destroy } = {}) => {
  jest.resetModules();

  const userFindAll = jest.fn().mockResolvedValue(findAll);
  const userFindByPk = jest.fn().mockResolvedValue(findByPk);
  const userFindOne = jest.fn().mockResolvedValue(findOne);

  jest.unstable_mockModule('../src/models/index.js', () => ({
    User: { findAll: userFindAll, findByPk: userFindByPk, findOne: userFindOne, create: jest.fn() },
    Role: {},
    Program: {},
    Position: {},
    Division: {},
    Photo: { create: jest.fn(), findByPk: jest.fn() },
    Location: { create: jest.fn(), findOne: jest.fn() },
    AttendanceCategory: {},
    sequelize: { transaction: jest.fn().mockResolvedValue({ commit: jest.fn(), rollback: jest.fn() }) }
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
  }));

  jest.unstable_mockModule('../src/config/spaces.js', () => ({
    buildUserProfilePhotoKey: jest.fn(() => 'users/7/photo.jpg'),
    uploadBufferToSpaces: jest.fn(async () => ({ key: 'users/7/photo.jpg', url: 'https://cdn' })),
    deleteSpacesObject: jest.fn()
  }));

  const mod = await import('../src/controllers/user.controller.js');
  return { ...mod, userFindAll, userFindByPk, userFindOne, destroy };
};

/**
 * Since INF-251/INF-261 the list and detail projections are deliberately
 * different surfaces: the list row is slim (no phone, no raw coordinates,
 * a location_status readiness flag), while the detail keeps the full shape.
 */
const expectedListRow = {
  id: 7,
  full_name: 'Nadia Putri',
  email: 'nadia@example.com',
  role_name: 'User',
  position_name: 'Backend Engineer',
  program_name: 'Internship',
  division_name: 'Engineering',
  nip_nim: 'A12345',
  photo: 'https://cdn.example/nadia.jpg',
  photo_updated_at: '2026-07-01',
  location_status: 'configured',
  created_at: undefined,
  updated_at: undefined
};

const expectedDetailUser = {
  ...expectedListRow,
  phone: '081234567890',
  location: {
    location_id: 12,
    latitude: -0.8917,
    longitude: 119.8707,
    radius: 150,
    description: 'Rumah Nadia',
    category_name: 'Work From Home'
  }
};
delete expectedDetailUser.location_status;

describe('getAllUsers payload', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps a fully populated row to the slim documented list shape', async () => {
    const { getAllUsers } = await loadUsers({ findAll: [fullUserRow()] });
    const res = buildRes();

    await getAllUsers({ query: {}, user: { id: 1 } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [expectedListRow],
      message: 'Users fetched successfully'
    });
  });

  it('never exposes phone or raw coordinates on the list surface', async () => {
    const { getAllUsers } = await loadUsers({ findAll: [fullUserRow()] });
    const res = buildRes();

    await getAllUsers({ query: {}, user: { id: 1 } }, res, jest.fn());

    const row = res.json.mock.calls[0][0].data[0];
    expect(row).not.toHaveProperty('phone');
    expect(row).not.toHaveProperty('location');
  });

  it('nulls every optional association and flags a missing WFH location', async () => {
    const bare = fullUserRow({
      role: null,
      position: null,
      program: null,
      division: null,
      photo_file: null,
      wfh_location: null
    });
    const { getAllUsers } = await loadUsers({ findAll: [bare] });
    const res = buildRes();

    await getAllUsers({ query: {}, user: { id: 1 } }, res, jest.fn());

    const row = res.json.mock.calls[0][0].data[0];
    expect(row).toMatchObject({
      role_name: null,
      position_name: null,
      program_name: null,
      division_name: null,
      photo: null,
      photo_updated_at: null,
      location_status: 'integrity_error'
    });
  });

  it('excludes soft-deleted users through the where clause', async () => {
    const { getAllUsers, userFindAll } = await loadUsers({ findAll: [] });

    await getAllUsers({ query: {}, user: { id: 1 } }, buildRes(), jest.fn());

    expect(userFindAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deleted_at: null })
      })
    );
  });

  it('searches full_name and nip_nim only', async () => {
    const { getAllUsers, userFindAll } = await loadUsers({ findAll: [] });

    await getAllUsers({ query: { search: 'nadia' }, user: { id: 1 } }, buildRes(), jest.fn());

    const { where } = userFindAll.mock.calls[0][0];
    const orClause = Object.getOwnPropertySymbols(where)
      .map((sym) => where[sym])
      .find(Array.isArray);

    expect(orClause).toHaveLength(2);
    const searchedFields = orClause.map((clause) => Object.keys(clause)[0]);
    expect(searchedFields).toEqual(['full_name', 'nip_nim']);
  });

  it('returns an empty data array rather than 404 when nothing matches', async () => {
    const { getAllUsers } = await loadUsers({ findAll: [] });
    const res = buildRes();

    await getAllUsers({ query: { search: 'zzz' }, user: { id: 1 } }, res, jest.fn());

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data).toEqual([]);
  });

  /**
   * There is no pagination. getAllUsers returns every non-deleted user in one
   * response. Recorded as F20 -- it is also what INF-250 exists to address.
   */
  it('applies no limit or offset', async () => {
    const { getAllUsers, userFindAll } = await loadUsers({ findAll: [] });

    await getAllUsers({ query: { page: '2', limit: '10' }, user: { id: 1 } }, buildRes(), jest.fn());

    const options = userFindAll.mock.calls[0][0];
    expect(options.limit).toBeUndefined();
    expect(options.offset).toBeUndefined();
  });

  it('forwards a query failure to the error handler', async () => {
    jest.resetModules();
    const boom = new Error('db down');
    jest.unstable_mockModule('../src/models/index.js', () => ({
      User: { findAll: jest.fn().mockRejectedValue(boom), findByPk: jest.fn(), findOne: jest.fn() },
      Role: {},
      Program: {},
      Position: {},
      Division: {},
      Photo: {},
      Location: {},
      AttendanceCategory: {},
      sequelize: { transaction: jest.fn() }
    }));
    jest.unstable_mockModule('../src/utils/logger.js', () => ({
      default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
    }));
    jest.unstable_mockModule('../src/config/spaces.js', () => ({
      buildUserProfilePhotoKey: jest.fn(),
      uploadBufferToSpaces: jest.fn(),
      deleteSpacesObject: jest.fn()
    }));

    const { getAllUsers } = await import('../src/controllers/user.controller.js');
    const res = buildRes();
    const next = jest.fn();

    await getAllUsers({ query: {}, user: { id: 1 } }, res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('getUserById payload', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the full detail projection including phone and location', async () => {
    const { getUserById } = await loadUsers({ findOne: fullUserRow() });
    const res = buildRes();

    await getUserById({ params: { id: '7' }, user: { id: 1 } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expectedDetailUser,
      message: 'User details fetched successfully'
    });
  });

  it('coerces the location numerics from strings to numbers', async () => {
    const { getUserById } = await loadUsers({ findOne: fullUserRow() });
    const res = buildRes();

    await getUserById({ params: { id: '7' }, user: { id: 1 } }, res, jest.fn());

    const { location } = res.json.mock.calls[0][0].data;
    expect(typeof location.latitude).toBe('number');
    expect(typeof location.longitude).toBe('number');
    expect(typeof location.radius).toBe('number');
  });

  it('defaults the location category name when the association is missing', async () => {
    const row = fullUserRow();
    row.wfh_location = { ...row.wfh_location, attendance_category: null };
    const { getUserById } = await loadUsers({ findOne: row });
    const res = buildRes();

    await getUserById({ params: { id: '7' }, user: { id: 1 } }, res, jest.fn());

    expect(res.json.mock.calls[0][0].data.location.category_name).toBe('Work From Home');
  });

  it('returns 404 with E_NOT_FOUND when the user does not exist', async () => {
    const { getUserById } = await loadUsers({ findOne: null });
    const res = buildRes();

    await getUserById({ params: { id: '999' }, user: { id: 1 } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      code: 'E_NOT_FOUND',
      message: 'User not found'
    });
  });

  /**
   * getUserById excludes soft-deleted rows in the query itself, whereas
   * deleteUser fetches by primary key and inspects deleted_at afterwards.
   * Two approaches to the same concern in one file; the extracted repository
   * should settle on one. Recorded as F22.
   */
  it('filters soft-deleted rows in the query rather than after fetching', async () => {
    const { getUserById, userFindOne, userFindByPk } = await loadUsers({ findOne: fullUserRow() });

    await getUserById({ params: { id: '7' }, user: { id: 1 } }, buildRes(), jest.fn());

    expect(userFindOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id_users: '7', deleted_at: null })
      })
    );
    expect(userFindByPk).not.toHaveBeenCalled();
  });
});

describe('deleteUser semantics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('soft deletes and confirms', async () => {
    const row = { ...fullUserRow(), deleted_at: null, destroy: jest.fn().mockResolvedValue() };
    const { deleteUser } = await loadUsers({ findByPk: row });
    const res = buildRes();

    await deleteUser({ params: { id: '7' }, user: { id: 1 } }, res, jest.fn());

    expect(row.destroy).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'User soft deleted successfully'
    });
  });

  it('returns 404 when the user does not exist', async () => {
    const { deleteUser } = await loadUsers({ findByPk: null });
    const res = buildRes();

    await deleteUser({ params: { id: '999' }, user: { id: 1 } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'User not found'
    });
  });

  /**
   * An already soft-deleted user is reported as "not found" rather than as a
   * conflict, and the row is not destroyed twice. That makes delete
   * non-idempotent from the client's point of view: the second call fails.
   */
  it('treats an already soft-deleted user as not found and does not destroy again', async () => {
    const row = {
      ...fullUserRow(),
      deleted_at: '2026-07-01T00:00:00Z',
      destroy: jest.fn()
    };
    const { deleteUser } = await loadUsers({ findByPk: row });
    const res = buildRes();

    await deleteUser({ params: { id: '7' }, user: { id: 1 } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(row.destroy).not.toHaveBeenCalled();
  });

  /**
   * getUserById's 404 carries code E_NOT_FOUND; deleteUser's does not. Both
   * describe the same condition. Recorded as F21.
   */
  it('omits the error code that getUserById includes for the same condition', async () => {
    const { deleteUser } = await loadUsers({ findByPk: null });
    const res = buildRes();

    await deleteUser({ params: { id: '999' }, user: { id: 1 } }, res, jest.fn());

    expect(res.json.mock.calls[0][0]).not.toHaveProperty('code');
  });
});
