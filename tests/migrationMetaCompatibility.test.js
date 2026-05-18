import { jest } from '@jest/globals';

import {
  LEGACY_MIGRATION_NAME_ALIASES,
  planMigrationMetaReconciliation,
  reconcileMigrationMeta
} from '../scripts/migrationMetaCompatibility.js';

describe('migration metadata compatibility', () => {
  test('renames legacy .js entries to .cjs when only legacy names exist', () => {
    const operations = planMigrationMetaReconciliation([
      '20260403000000-add-unique-constraint-attendance.js'
    ]);

    expect(operations).toContainEqual({
      type: 'rename',
      from: '20260403000000-add-unique-constraint-attendance.js',
      to: '20260403000000-add-unique-constraint-attendance.cjs'
    });
  });

  test('drops duplicate legacy .js entries when both names already exist', () => {
    const operations = planMigrationMetaReconciliation([
      '20260422000000-add-photo-storage-metadata.js',
      '20260422000000-add-photo-storage-metadata.cjs'
    ]);

    expect(operations).toContainEqual({
      type: 'delete-legacy',
      from: '20260422000000-add-photo-storage-metadata.js',
      to: '20260422000000-add-photo-storage-metadata.cjs'
    });
  });

  test('tracks all migration filename aliases that need compatibility handling', () => {
    expect(LEGACY_MIGRATION_NAME_ALIASES).toEqual([
      {
        legacy: '20240619000000-update-photos-for-cloudinary.js',
        current: '20240619000000-update-photos-for-cloudinary.cjs'
      },
      {
        legacy: '20260403000000-add-unique-constraint-attendance.js',
        current: '20260403000000-add-unique-constraint-attendance.cjs'
      },
      {
        legacy: '20260422000000-add-photo-storage-metadata.js',
        current: '20260422000000-add-photo-storage-metadata.cjs'
      },
      {
        legacy: '20260423010000-add-attendance-date-index.js',
        current: '20260423010000-add-attendance-date-index.cjs'
      },
      {
        legacy: '20260424000000-bootstrap-operational-settings.js',
        current: '20260424000000-bootstrap-operational-settings.cjs'
      }
    ]);
  });

  test('treats missing migration metadata tables as a no-op reconciliation', async () => {
    const sequelize = {
      query: jest.fn(async (sql) => {
        if (sql.includes('SequelizeMeta')) {
          throw new Error("Table 'defaultdb.SequelizeMeta' doesn't exist");
        }
        if (sql.includes('sequelizemeta')) {
          throw new Error("Table 'defaultdb.sequelizemeta' doesn't exist");
        }
        throw new Error(`Unexpected query: ${sql}`);
      })
    };

    await expect(reconcileMigrationMeta(sequelize)).resolves.toEqual([]);
    expect(sequelize.query).toHaveBeenCalledTimes(2);
  });

  test('reconciles legacy entries from the lower-case sequelizemeta table when that is the active metadata table', async () => {
    const sequelize = {
      query: jest.fn(async (sql, options) => {
        if (sql.includes('SELECT name FROM SequelizeMeta')) {
          throw new Error("Table 'defaultdb.SequelizeMeta' doesn't exist");
        }

        if (sql.includes('SELECT name FROM sequelizemeta')) {
          return [[{ name: '20260423010000-add-attendance-date-index.js' }]];
        }

        if (sql.includes('UPDATE sequelizemeta SET name = :to WHERE name = :from')) {
          return [[], []];
        }

        throw new Error(`Unexpected query: ${sql} ${JSON.stringify(options || {})}`);
      })
    };

    await expect(reconcileMigrationMeta(sequelize)).resolves.toEqual([
      {
        type: 'rename',
        from: '20260423010000-add-attendance-date-index.js',
        to: '20260423010000-add-attendance-date-index.cjs'
      }
    ]);
  });
});
