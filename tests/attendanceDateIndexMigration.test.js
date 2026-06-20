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

  test('adds only the attendance date index when it is missing', async () => {
    mockQuery.mockResolvedValue([[{ Key_name: 'uq_attendance_user_date' }]]);

    const migration = await import('../src/models/migrations/20260423010000-add-attendance-date-index.cjs');
    await migration.default.up(queryInterface);

    expect(mockAddIndex).toHaveBeenCalledTimes(1);
    expect(mockAddIndex).toHaveBeenCalledWith(
      'attendance',
      ['attendance_date'],
      expect.objectContaining({
        name: 'idx_attendance_date',
        transaction: 'tx'
      })
    );
  });

  test('does not add indexes that already exist', async () => {
    mockQuery.mockResolvedValueOnce([
      [{ Key_name: 'idx_attendance_date' }, { Key_name: 'uq_attendance_user_date' }]
    ]);

    const migration = await import('../src/models/migrations/20260423010000-add-attendance-date-index.cjs');
    await migration.default.up(queryInterface);

    expect(mockAddIndex).not.toHaveBeenCalled();
  });

  test('removes only the attendance date index on rollback', async () => {
    mockQuery.mockResolvedValueOnce([
      [{ Key_name: 'idx_attendance_date' }, { Key_name: 'uq_attendance_user_date' }]
    ]);

    const migration = await import('../src/models/migrations/20260423010000-add-attendance-date-index.cjs');
    await migration.default.down(queryInterface);

    expect(mockRemoveIndex).toHaveBeenCalledTimes(1);
    expect(mockRemoveIndex).toHaveBeenCalledWith('attendance', 'idx_attendance_date', {
      transaction: 'tx'
    });
  });

  test('skips rollback removal when the date index is already absent', async () => {
    mockQuery.mockResolvedValueOnce([[{ Key_name: 'uq_attendance_user_date' }]]);

    const migration = await import('../src/models/migrations/20260423010000-add-attendance-date-index.cjs');
    await migration.default.down(queryInterface);

    expect(mockRemoveIndex).not.toHaveBeenCalled();
  });
});
