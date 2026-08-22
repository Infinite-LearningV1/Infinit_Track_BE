import { createRequire } from 'node:module';
import { jest } from '@jest/globals';
import { DataTypes, Op } from 'sequelize';

const require = createRequire(import.meta.url);
let migration = null;

try {
  migration = require('../src/models/migrations/20260728010000-add-wfa-request-policy.cjs');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const Sequelize = { ...DataTypes, Op };

describe('INF-270 WFA policy migration', () => {
  it('adds reason catalogs, defaults, booking fields, indexes, and restrictive foreign keys', async () => {
    expect(migration).not.toBeNull();

    const queryInterface = {
      sequelize: {
        query: jest.fn().mockResolvedValue([[]]),
        transaction: jest.fn(async (callback) => callback({ id: 'transaction' }))
      },
      bulkInsert: jest.fn().mockResolvedValue(undefined),
      createTable: jest.fn().mockResolvedValue(undefined),
      addColumn: jest.fn().mockResolvedValue(undefined),
      addIndex: jest.fn().mockResolvedValue(undefined),
      addConstraint: jest.fn().mockResolvedValue(undefined)
    };

    await migration.up(queryInterface, Sequelize);

    expect(queryInterface.bulkInsert).toHaveBeenCalledWith(
      'settings',
      expect.arrayContaining([
        expect.objectContaining({ setting_key: 'wfa.request.radius_m', setting_value: '100' })
      ]),
      expect.objectContaining({ transaction: expect.any(Object) })
    );
    expect(queryInterface.createTable).toHaveBeenCalledWith(
      'wfa_request_reasons',
      expect.any(Object),
      expect.objectContaining({ transaction: expect.any(Object) })
    );
    expect(queryInterface.createTable).toHaveBeenCalledWith(
      'wfa_rejection_reasons',
      expect.any(Object),
      expect.objectContaining({ transaction: expect.any(Object) })
    );
    expect(queryInterface.addColumn.mock.calls.map((call) => call[1])).toEqual([
      'request_reason_id',
      'request_other_reason',
      'rejection_reason_id',
      'rejection_note',
      'radius_snapshot'
    ]);
    expect(queryInterface.addIndex).toHaveBeenCalledTimes(2);
    expect(queryInterface.addConstraint).toHaveBeenCalledWith(
      'bookings',
      expect.objectContaining({
        fields: ['request_reason_id'],
        type: 'foreign key',
        onDelete: 'RESTRICT'
      })
    );
    expect(queryInterface.addConstraint).toHaveBeenCalledWith(
      'bookings',
      expect.objectContaining({
        fields: ['rejection_reason_id'],
        type: 'foreign key',
        onDelete: 'RESTRICT'
      })
    );
  });

  it('removes only INF-270 fields on rollback and leaves legacy rejection_reason alone', async () => {
    expect(migration).not.toBeNull();

    const queryInterface = {
      sequelize: {
        transaction: jest.fn(async (callback) => callback({ id: 'transaction' }))
      },
      removeConstraint: jest.fn().mockResolvedValue(undefined),
      removeIndex: jest.fn().mockResolvedValue(undefined),
      removeColumn: jest.fn().mockResolvedValue(undefined),
      dropTable: jest.fn().mockResolvedValue(undefined),
      bulkDelete: jest.fn().mockResolvedValue(undefined)
    };

    await migration.down(queryInterface, Sequelize);

    const removedColumns = queryInterface.removeColumn.mock.calls.map((call) => call[1]);
    expect(removedColumns).toEqual([
      'radius_snapshot',
      'rejection_note',
      'rejection_reason_id',
      'request_other_reason',
      'request_reason_id'
    ]);
    expect(removedColumns).not.toContain('rejection_reason');
    expect(queryInterface.bulkDelete).toHaveBeenCalledWith(
      'settings',
      {
        setting_key: 'wfa.request.radius_m',
        description: '[INF-270] Global radius in meters for WFA booking requests.'
      },
      expect.objectContaining({ transaction: expect.any(Object) })
    );
  });
});
