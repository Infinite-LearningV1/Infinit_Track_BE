import { jest } from '@jest/globals';

/**
 * Characterization coverage for the sort parameters of GET /api/users (F49).
 *
 * `getAllUsers` reads `sortBy` and `sortOrder` from the query string and passes
 * both straight into `order: [[sortBy, sortOrder.toUpperCase()]]`. Nothing
 * validates either one: the route mounts no validator on `GET /`, the
 * controller checks nothing, and there is no query object yet.
 *
 * These tests pin the absence deliberately. Spec 3.3 requires a strict
 * per-endpoint allowlist, so INF-252 Phase 2 slice 3 is where this closes --
 * and when it does, the two "no allowlist" tests below must fail and be
 * rewritten. That is the point of them.
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
   * DEFECT, characterized not fixed. There is no column allowlist, so any
   * string the caller supplies becomes an ORDER BY identifier. Sequelize
   * quotes identifiers, so this is not SQL injection -- but an unknown column
   * reaches the database and the resulting error surfaces as a 500. Confirming
   * that end to end needs the Phase 0c integration harness; what is provable
   * here is that nothing stops the value.
   */
  it('passes an arbitrary sortBy through with no allowlist', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    const { getAllUsers } = await loadController({ findAll });

    await getAllUsers({ query: { sortBy: 'password' } }, buildRes(), jest.fn());

    expect(orderFrom(findAll)).toEqual([['password', 'DESC']]);
  });

  /**
   * DEFECT, characterized not fixed, and this half is fully provable.
   *
   * Express parses `?sortOrder[]=x` into an array, and arrays have no
   * toUpperCase. The call throws before the query is ever built, the catch
   * forwards it, and the caller receives a 500 for a request that is merely
   * malformed. A validated parameter would be a 400.
   */
  it('throws on an array sortOrder, turning a malformed query into a 500', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    const { getAllUsers } = await loadController({ findAll });
    const res = buildRes();
    const next = jest.fn();

    await getAllUsers({ query: { sortOrder: ['x'] } }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const [error] = next.mock.calls[0];
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toMatch(/toUpperCase is not a function/);

    // It fails before the query is built, and nothing is sent to the client.
    expect(findAll).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  /**
   * The same shape one level up: an array sortBy survives all the way into the
   * order clause, because only the direction is ever coerced.
   */
  it('lets an array sortBy reach the order clause intact', async () => {
    const findAll = jest.fn().mockResolvedValue([]);
    const { getAllUsers } = await loadController({ findAll });

    await getAllUsers({ query: { sortBy: ['x'] } }, buildRes(), jest.fn());

    expect(orderFrom(findAll)).toEqual([[['x'], 'DESC']]);
  });
});
