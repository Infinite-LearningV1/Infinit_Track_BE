import { createRequire } from 'node:module';

import { jest } from '@jest/globals';
import { DataTypes } from 'sequelize';

import { WFA_MATRIX_VERSION } from '../src/analytics/config.fahp.js';
import Booking from '../src/models/booking.model.js';
import fuzzyEngine from '../src/utils/fuzzyAhpEngine.js';

const require = createRequire(import.meta.url);
let migration = null;

try {
  migration = require('../src/models/migrations/20260815010000-add-wfa-scoring-snapshot.cjs');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const Sequelize = { ...DataTypes };

describe('WFA scoring snapshot persistence contract', () => {
  it('adds and removes exactly one nullable JSON booking snapshot column', async () => {
    expect(migration).not.toBeNull();

    const queryInterface = {
      addColumn: jest.fn().mockResolvedValue(undefined),
      removeColumn: jest.fn().mockResolvedValue(undefined)
    };

    await migration.up(queryInterface, Sequelize);
    await migration.down(queryInterface, Sequelize);

    expect(queryInterface.addColumn).toHaveBeenCalledTimes(1);
    expect(queryInterface.addColumn).toHaveBeenCalledWith('bookings', 'wfa_scoring_snapshot', {
      type: Sequelize.JSON,
      allowNull: true
    });
    expect(queryInterface.removeColumn).toHaveBeenCalledTimes(1);
    expect(queryInterface.removeColumn).toHaveBeenCalledWith('bookings', 'wfa_scoring_snapshot');
  });

  it('maps the snapshot column on Booking and keeps the canonical WFA matrix version on repeated reads', () => {
    expect(Booking.rawAttributes).toHaveProperty('wfa_scoring_snapshot');
    expect(Booking.rawAttributes.wfa_scoring_snapshot.allowNull).toBe(true);
    expect(Booking.rawAttributes.wfa_scoring_snapshot.type.key).toBe('JSON');

    const first = fuzzyEngine.getWfaAhpWeights();
    const second = fuzzyEngine.getWfaAhpWeights();

    expect(first).toMatchObject({
      version: WFA_MATRIX_VERSION,
      weighting_method: expect.any(String),
      consistency_ratio: expect.any(Number)
    });
    expect(second).toMatchObject({
      version: WFA_MATRIX_VERSION,
      weighting_method: first.weighting_method,
      consistency_ratio: first.consistency_ratio
    });
    expect(second.location_type).toBe(first.location_type);
    expect(second.distance_factor).toBe(first.distance_factor);
    expect(second.facility_score).toBe(first.facility_score);
  });
});
