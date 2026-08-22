import { jest } from '@jest/globals';

/**
 * Sort-parameter contract for GET /api/users.
 *
 * F49 CLOSED by INF-262: the route now mounts validateListUsers (rejecting
 * off-whitelist sortBy and malformed sortOrder with 400), and the controller
 * itself maps sortBy through USER_LIST_SORT_COLUMNS as defense in depth --
 * an unexpected value falls back to created_at instead of reaching ORDER BY,
 * and a malformed sortOrder falls back to DESC instead of crashing to a 500.
 * These tests exercise the controller layer directly, past the validator.
 */

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const loadController = async ({ findAll }) => {
  jest.unstable_mockModule('../src/models/index.js', () => ({
    User: { findAll },
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

const orderFrom = (findAll) => findAll.mock.calls[0][0].order;

describe('GET /users sort parameters (F49)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('defaults to created_at DESC when neither parameter is sent', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    const { getAllUsers } = await loadController({ findAll });

    await getAllUsers({ query: {} }, buildRes(), jest.fn());

    expect(orderFrom(findAll)).toEqual([['created_at', 'DESC']]);
  });

  it('uppercases the direction, so a lowercase value still works', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    const { getAllUsers } = await loadController({ findAll });

    await getAllUsers({ query: { sortOrder: 'asc' } }, buildRes(), jest.fn());

    expect(orderFrom(findAll)).toEqual([['created_at', 'ASC']]);
  });

  /**
   * F49 closed: an off-whitelist column never reaches ORDER BY. The validator
   * already rejects it with 400 at the route; if anything slips past, the
   * controller maps it to the default column.
   */
  it('maps an off-whitelist sortBy to the default column instead of passing it through', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    const { getAllUsers } = await loadController({ findAll });

    await getAllUsers({ query: { sortBy: 'password' } }, buildRes(), jest.fn());

    expect(orderFrom(findAll)).toEqual([['created_at', 'DESC']]);
  });

  /**
   * F49 closed: an array sortOrder no longer crashes into a 500. The validator
   * rejects it with 400 at the route; defense in depth in the controller
   * coerces anything unexpected to the DESC default.
   */
  it('handles an array sortOrder without crashing, falling back to DESC', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    const { getAllUsers } = await loadController({ findAll });
    const res = buildRes();
    const next = jest.fn();

    await getAllUsers({ query: { sortOrder: ['x'] } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(orderFrom(findAll)).toEqual([['created_at', 'DESC']]);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  it('maps an array sortBy to the default column instead of passing it through', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    const { getAllUsers } = await loadController({ findAll });

    await getAllUsers({ query: { sortBy: ['x'] } }, buildRes(), jest.fn());

    expect(orderFrom(findAll)).toEqual([['created_at', 'DESC']]);
  });
});
