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

describe('attendance user date index migration', () => {
  beforeEach(() => {
    jest.resetModules();
    mockAddIndex.mockReset();
    mockRemoveIndex.mockReset();
    mockQuery.mockReset();
    mockTransaction.mockClear();
  });

  test('adds the attendance user date index when no equivalent index exists', async () => {
    mockQuery.mockResolvedValue([[{ Key_name: 'idx_attendance_date' }]]);

    const migration = await import('../src/models/migrations/20260529010000-add-attendance-user-date-index.cjs');
    await migration.default.up(queryInterface);

    expect(mockAddIndex).toHaveBeenCalledTimes(1);
    expect(mockAddIndex).toHaveBeenCalledWith(
      'attendance',
      ['user_id', 'attendance_date'],
      expect.objectContaining({
        name: 'idx_attendance_user_date',
        transaction: 'tx'
      })
    );
  });

  test('does not add the non-unique index when the unique user date index already exists', async () => {
    mockQuery.mockResolvedValueOnce([[{ Key_name: 'idx_attendance_date' }, { Key_name: 'uq_attendance_user_date' }]]);

    const migration = await import('../src/models/migrations/20260529010000-add-attendance-user-date-index.cjs');
    await migration.default.up(queryInterface);

    expect(mockAddIndex).not.toHaveBeenCalled();
  });

  test('does not add the index when it already exists', async () => {
    mockQuery.mockResolvedValueOnce([
      [
        { Key_name: 'idx_attendance_date' },
        { Key_name: 'uq_attendance_user_date' },
        { Key_name: 'idx_attendance_user_date' }
      ]
    ]);

    const migration = await import('../src/models/migrations/20260529010000-add-attendance-user-date-index.cjs');
    await migration.default.up(queryInterface);

    expect(mockAddIndex).not.toHaveBeenCalled();
  });

  test('removes only the attendance user date index on rollback', async () => {
    mockQuery.mockResolvedValueOnce([
      [
        { Key_name: 'idx_attendance_date' },
        { Key_name: 'uq_attendance_user_date' },
        { Key_name: 'idx_attendance_user_date' }
      ]
    ]);

    const migration = await import('../src/models/migrations/20260529010000-add-attendance-user-date-index.cjs');
    await migration.default.down(queryInterface);

    expect(mockRemoveIndex).toHaveBeenCalledTimes(1);
    expect(mockRemoveIndex).toHaveBeenCalledWith('attendance', 'idx_attendance_user_date', {
      transaction: 'tx'
    });
  });

  test('skips rollback removal when the user date index is already absent', async () => {
    mockQuery.mockResolvedValueOnce([[{ Key_name: 'idx_attendance_date' }, { Key_name: 'uq_attendance_user_date' }]]);

    const migration = await import('../src/models/migrations/20260529010000-add-attendance-user-date-index.cjs');
    await migration.default.down(queryInterface);

    expect(mockRemoveIndex).not.toHaveBeenCalled();
  });
});
