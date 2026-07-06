import { jest } from '@jest/globals';

const mockCreateTable = jest.fn();
const mockBulkInsert = jest.fn();
const mockDropTable = jest.fn();

const queryInterface = {
  createTable: mockCreateTable,
  bulkInsert: mockBulkInsert,
  dropTable: mockDropTable
};

const Sequelize = {
  INTEGER: 'INTEGER',
  STRING: (length) => `STRING(${length})`,
  TEXT: 'TEXT',
  BOOLEAN: 'BOOLEAN',
  DATE: 'DATE'
};

describe('attendance session states migration', () => {
  beforeEach(() => {
    jest.resetModules();
    mockCreateTable.mockReset();
    mockBulkInsert.mockReset();
    mockDropTable.mockReset();
  });

  it('creates and seeds the attendance session states master table', async () => {
    const migration = await import('../src/models/migrations/20260707010000-create-attendance-session-states.cjs');

    await migration.default.up(queryInterface, Sequelize);

    expect(mockCreateTable).toHaveBeenCalledWith(
      'attendance_session_states',
      expect.objectContaining({
        id_attendance_session_state: expect.objectContaining({ primaryKey: true, autoIncrement: true }),
        state_key: expect.objectContaining({ allowNull: false, unique: true }),
        state_label: expect.objectContaining({ allowNull: false }),
        sort_order: expect.objectContaining({ allowNull: false, defaultValue: 0 }),
        is_active: expect.objectContaining({ allowNull: false, defaultValue: true })
      })
    );
    expect(mockBulkInsert).toHaveBeenCalledWith(
      'attendance_session_states',
      expect.arrayContaining([
        expect.objectContaining({ state_key: 'not_started', state_label: 'Not Started', sort_order: 1 }),
        expect.objectContaining({ state_key: 'active', state_label: 'Active Session', sort_order: 2 }),
        expect.objectContaining({ state_key: 'completed', state_label: 'Completed Today', sort_order: 3 }),
        expect.objectContaining({ state_key: 'unavailable', state_label: 'Unavailable', sort_order: 4 })
      ])
    );
  });

  it('drops the attendance session states master table on rollback', async () => {
    const migration = await import('../src/models/migrations/20260707010000-create-attendance-session-states.cjs');

    await migration.default.down(queryInterface);

    expect(mockDropTable).toHaveBeenCalledWith('attendance_session_states');
  });
});
