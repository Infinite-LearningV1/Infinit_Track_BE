import { jest } from '@jest/globals';

/**
 * Characterization coverage for the discipline controllers
 * (INF-252 Phase 0b).
 *
 * routeAuthorizationMatrix.test.js proved that three of these four routes
 * carry no roleGuard (finding F10). This file pins the authorization those
 * three enforce in the controller body instead, plus their payloads.
 *
 * The FAHP engine is mocked. FAHP theory is locked, so the assertions cover
 * the controller's orchestration and access rules, never the algorithm's
 * numbers.
 */

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const userRow = () => ({
  id_users: 9,
  full_name: 'Nadia Putri',
  nip_nim: 'A12345',
  role: { role_name: 'User' }
});

const loadDiscipline = async ({ user = userRow(), users = [], attendances = [] } = {}) => {
  jest.resetModules();

  const userFindByPk = jest.fn().mockResolvedValue(user);
  const userFindAll = jest.fn().mockResolvedValue(users);
  const attendanceFindAll = jest.fn().mockResolvedValue(attendances);

  jest.unstable_mockModule('../src/models/index.js', () => ({
    User: { findByPk: userFindByPk, findAll: userFindAll },
    Attendance: { findAll: attendanceFindAll },
    Role: {},
    Program: {},
    Position: {},
    Division: {},
    AttendanceCategory: {},
    Location: {},
    Photo: {}
  }));

  jest.unstable_mockModule('../src/utils/fuzzyAhpEngine.js', () => ({
    default: {
      getDisciplineAhpWeights: () => ({
        attendance_rate: 0.4,
        punctuality: 0.3,
        consistency: 0.3,
        consistency_ratio: 0.04
      }),
      calculateDisciplineIndex: jest.fn(async () => ({
        score: 82,
        label: 'DISIPLIN',
        breakdown: {}
      }))
    }
  }));

  jest.unstable_mockModule('../src/utils/logger.js', () => ({
    default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
  }));

  const mod = await import('../src/controllers/discipline.controller.js');
  return { ...mod, userFindByPk, userFindAll };
};

const asRole = (role_name, id = 1) => ({ id, role_name });

describe('getUserDisciplineIndex access rules', () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuses a plain User reading another user's index", async () => {
    const { getUserDisciplineIndex } = await loadDiscipline();
    const res = buildRes();

    await getUserDisciplineIndex(
      { params: { userId: '9' }, query: {}, user: asRole('User', 1) },
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Akses ditolak. Anda hanya dapat melihat indeks kedisiplinan Anda sendiri.'
    });
  });

  it('allows a plain User to read their own index', async () => {
    const { getUserDisciplineIndex } = await loadDiscipline();
    const res = buildRes();

    await getUserDisciplineIndex(
      { params: { userId: '9' }, query: {}, user: asRole('User', 9) },
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it.each([['Admin'], ['Management']])('allows %s to read any index', async (role) => {
    const { getUserDisciplineIndex } = await loadDiscipline();
    const res = buildRes();

    await getUserDisciplineIndex(
      { params: { userId: '9' }, query: {}, user: asRole(role, 1) },
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 404 when the target user does not exist', async () => {
    const { getUserDisciplineIndex } = await loadDiscipline({ user: null });
    const res = buildRes();

    await getUserDisciplineIndex(
      { params: { userId: '999' }, query: {}, user: asRole('Admin') },
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'User tidak ditemukan.'
    });
  });

  it('returns user info, analysis period and discipline index', async () => {
    const { getUserDisciplineIndex } = await loadDiscipline();
    const res = buildRes();

    await getUserDisciplineIndex(
      { params: { userId: '9' }, query: { months: 3 }, user: asRole('Admin') },
      res,
      jest.fn()
    );

    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.user_info).toEqual({
      user_id: 9,
      full_name: 'Nadia Putri',
      nip_nim: 'A12345',
      role: 'User'
    });
    expect(body.data.analysis_period.months_analyzed).toBe(3);
    expect(body.data.discipline_index).toMatchObject({ score: 82, label: 'DISIPLIN' });
  });

  it('defaults the analysis window to one month', async () => {
    const { getUserDisciplineIndex } = await loadDiscipline();
    const res = buildRes();

    await getUserDisciplineIndex(
      { params: { userId: '9' }, query: {}, user: asRole('Admin') },
      res,
      jest.fn()
    );

    expect(res.json.mock.calls[0][0].data.analysis_period.months_analyzed).toBe(1);
  });
});

describe('getAllDisciplineIndices and getDisciplineConfig access rules', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['getAllDisciplineIndices'],
    ['getDisciplineConfig']
  ])('%s refuses a plain User from inside the controller', async (fnName) => {
    const mod = await loadDiscipline();
    const res = buildRes();

    await mod[fnName]({ params: {}, query: {}, user: asRole('User') }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it.each([['Admin'], ['Management']])('getDisciplineConfig serves %s', async (role) => {
    const { getDisciplineConfig } = await loadDiscipline();
    const res = buildRes();

    await getDisciplineConfig({ params: {}, query: {}, user: asRole(role) }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });

  it('getAllDisciplineIndices returns an empty list when no users match', async () => {
    const { getAllDisciplineIndices } = await loadDiscipline({ users: [] });
    const res = buildRes();

    await getAllDisciplineIndices({ params: {}, query: {}, user: asRole('Admin') }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
  });
});

describe('testDisciplineAhp', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires metrics', async () => {
    const { testDisciplineAhp } = await loadDiscipline();
    const res = buildRes();

    await testDisciplineAhp({ body: {}, user: asRole('Admin') }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: 'Parameter metrics wajib diisi'
    });
  });

  it('scores the supplied metrics without touching the database', async () => {
    const { testDisciplineAhp, userFindByPk, userFindAll } = await loadDiscipline();
    const res = buildRes();

    await testDisciplineAhp(
      { body: { metrics: { attendance_rate: 0.9 } }, user: asRole('Admin') },
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].success).toBe(true);
    expect(userFindByPk).not.toHaveBeenCalled();
    expect(userFindAll).not.toHaveBeenCalled();
  });
});
