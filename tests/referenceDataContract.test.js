import { jest } from '@jest/globals';

/**
 * Characterization coverage for the reference-data dropdowns
 * (INF-252 Phase 0b).
 *
 * The lowest-risk endpoints in the codebase, and the most uniform: four
 * read-only lookups that each select explicit attributes, order ascending,
 * and answer with the same { success, data, message } envelope.
 *
 * They are worth pinning precisely because they are the template the other
 * modules should converge on -- the attribute lists are the response contract,
 * and a migration that widens them would silently start leaking columns.
 */

const buildRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const loadReferenceData = async ({ rows = [], failWith } = {}) => {
  jest.resetModules();

  const makeModel = () => ({
    findAll: failWith ? jest.fn().mockRejectedValue(failWith) : jest.fn().mockResolvedValue(rows)
  });

  const Role = makeModel();
  const Program = makeModel();
  const Position = makeModel();
  const Division = makeModel();

  jest.unstable_mockModule('../src/models/index.js', () => ({
    Role,
    Program,
    Position,
    Division,
    User: {},
    Photo: {},
    Location: {},
    AttendanceCategory: {}
  }));

  const mod = await import('../src/controllers/referenceData.controller.js');
  return { ...mod, Role, Program, Position, Division };
};

describe('reference data envelopes', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['getRoles', 'Roles retrieved successfully'],
    ['getPrograms', 'Programs retrieved successfully'],
    ['getPositions', 'Positions retrieved successfully'],
    ['getDivisions', 'Divisions retrieved successfully']
  ])('%s answers 200 with the shared envelope and message "%s"', async (fnName, message) => {
    const rows = [{ id: 1 }];
    const mod = await loadReferenceData({ rows });
    const res = buildRes();

    await mod[fnName]({ query: {} }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: rows, message });
  });

  it.each([
    ['getRoles', 'Role', ['id_roles', 'role_name'], 'role_name'],
    ['getPrograms', 'Program', ['id_programs', 'program_name'], 'program_name'],
    ['getDivisions', 'Division', ['id_divisions', 'division_name'], 'division_name']
  ])('%s selects explicit attributes and orders by %s ascending', async (
    fnName,
    modelKey,
    attributes,
    orderField
  ) => {
    const mod = await loadReferenceData();

    await mod[fnName]({ query: {} }, buildRes(), jest.fn());

    expect(mod[modelKey].findAll).toHaveBeenCalledWith({
      attributes,
      order: [[orderField, 'ASC']]
    });
  });

  it('forwards a query failure to the error handler', async () => {
    const boom = new Error('db down');
    const { getRoles } = await loadReferenceData({ failWith: boom });
    const res = buildRes();
    const next = jest.fn();

    await getRoles({ query: {} }, res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('getPositions filtering', () => {
  beforeEach(() => jest.clearAllMocks());

  it('applies no filter when program_id is absent', async () => {
    const { getPositions, Position } = await loadReferenceData();

    await getPositions({ query: {} }, buildRes(), jest.fn());

    expect(Position.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('filters by program_id when supplied', async () => {
    const { getPositions, Position } = await loadReferenceData();

    await getPositions({ query: { program_id: '3' } }, buildRes(), jest.fn());

    expect(Position.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id_programs: '3' } })
    );
  });

  it('includes the parent program name and nothing else from it', async () => {
    const { getPositions, Position } = await loadReferenceData();

    await getPositions({ query: {} }, buildRes(), jest.fn());

    const options = Position.findAll.mock.calls[0][0];
    expect(options.attributes).toEqual(['id_positions', 'position_name', 'id_programs']);
    expect(options.include).toEqual([
      expect.objectContaining({ as: 'program', attributes: ['program_name'] })
    ]);
  });
});
