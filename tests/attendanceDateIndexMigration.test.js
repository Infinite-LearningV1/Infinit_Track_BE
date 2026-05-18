import { jest } from '@jest/globals';

const mockAddIndex = jest.fn();
const mockRemoveIndex = jest.fn();
const mockQuery = jest.fn();
const mockTransaction = jest.fn(async (cb) => cb('tx'));

const queryInterface = {
  addIndex: mockAddIndex,
  removeIndex: mockRemoveIndex,
  sequelize: {
    query: mockQuery,
    transaction: mockTransaction
  }
};

describe('attendance date index migration', () => {
  beforeEach(() => {
    jest.resetModules();
    mockAddIndex.mockReset();
    mockRemoveIndex.mockReset();
    mockQuery.mockReset();
    mockTransaction.mockClear();
  });

  test('adds idx_attendance_date when the index is missing', async () => {
    mockQuery.mockResolvedValueOnce([[{ Key_name: 'uq_attendance_user_date' }]]);

    const migration = await import('../src/models/migrations/20260423010000-add-attendance-date-index.cjs');
    await migration.default.up(queryInterface);

    expect(mockAddIndex).toHaveBeenCalledWith(
      'attendance',
      ['attendance_date'],
      expect.objectContaining({
        name: 'idx_attendance_date',
        transaction: 'tx'
      })
    );
  });

  test('does not add idx_attendance_date when the index already exists', async () => {
    mockQuery.mockResolvedValueOnce([[{ Key_name: 'idx_attendance_date' }]]);

    const migration = await import('../src/models/migrations/20260423010000-add-attendance-date-index.cjs');
    await migration.default.up(queryInterface);

    expect(mockAddIndex).not.toHaveBeenCalled();
  });

  test('removes idx_attendance_date on rollback', async () => {
    const migration = await import('../src/models/migrations/20260423010000-add-attendance-date-index.cjs');
    await migration.default.down(queryInterface);

    expect(mockRemoveIndex).toHaveBeenCalledWith('attendance', 'idx_attendance_date');
  });
});
