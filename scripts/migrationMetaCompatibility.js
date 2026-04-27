export const LEGACY_MIGRATION_NAME_ALIASES = [
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
];

export function planMigrationMetaReconciliation(existingNames) {
  const existing = new Set(existingNames);
  const operations = [];

  for (const alias of LEGACY_MIGRATION_NAME_ALIASES) {
    const hasLegacy = existing.has(alias.legacy);
    const hasCurrent = existing.has(alias.current);

    if (hasLegacy && hasCurrent) {
      operations.push({ type: 'delete-legacy', from: alias.legacy, to: alias.current });
      continue;
    }

    if (hasLegacy) {
      operations.push({ type: 'rename', from: alias.legacy, to: alias.current });
    }
  }

  return operations;
}

export async function reconcileMigrationMeta(sequelize) {
  const metadataTables = ['SequelizeMeta', 'sequelizemeta'];
  let metadataTable = null;
  let rows = [];

  for (const table of metadataTables) {
    try {
      [rows] = await sequelize.query(`SELECT name FROM ${table}`);
      metadataTable = table;
      break;
    } catch (error) {
      const message = String(error.message || '');
      if (message.includes(table) && message.includes("doesn't exist")) {
        continue;
      }

      throw error;
    }
  }

  if (!metadataTable) {
    return [];
  }

  const operations = planMigrationMetaReconciliation(rows.map((row) => row.name));

  for (const operation of operations) {
    if (operation.type === 'delete-legacy') {
      await sequelize.query(`DELETE FROM ${metadataTable} WHERE name = :from`, {
        replacements: { from: operation.from }
      });
      continue;
    }

    await sequelize.query(
      `UPDATE ${metadataTable} SET name = :to WHERE name = :from`,
      { replacements: { from: operation.from, to: operation.to } }
    );
  }

  return operations;
}
