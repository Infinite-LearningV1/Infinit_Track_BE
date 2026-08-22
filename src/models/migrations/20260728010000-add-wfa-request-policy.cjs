'use strict';

const REQUEST_REASON_TABLE = 'wfa_request_reasons';
const REJECTION_REASON_TABLE = 'wfa_rejection_reasons';
const BOOKINGS_TABLE = 'bookings';
const RADIUS_SETTING_KEY = 'wfa.request.radius_m';
const RADIUS_SETTING_DESCRIPTION = '[INF-270] Global radius in meters for WFA booking requests.';

const REQUEST_REASONS = [
  ['Pertemuan dengan klien', true, false, 10],
  ['Pekerjaan lapangan', true, false, 20],
  ['Perjalanan bisnis', true, false, 30],
  ['Lainnya', true, true, 999]
];

const REJECTION_REASONS = [
  ['Lokasi tidak memenuhi ketentuan', true, false, 10],
  ['Tanggal tidak dapat disetujui', true, false, 20],
  ['Alasan tidak sesuai kebijakan', true, false, 30],
  ['Data pengajuan belum lengkap', true, false, 40],
  ['Lainnya', true, true, 999]
];

const reasonColumns = (Sequelize) => ({
  id: {
    type: Sequelize.INTEGER,
    allowNull: false,
    autoIncrement: true,
    primaryKey: true
  },
  label: { type: Sequelize.STRING(120), allowNull: false },
  is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
  is_other: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
  sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
  created_at: { type: Sequelize.DATE, allowNull: false },
  updated_at: { type: Sequelize.DATE, allowNull: false }
});

const reasonRows = (rows, timestamp) =>
  rows.map(([label, is_active, is_other, sort_order]) => ({
    label,
    is_active,
    is_other,
    sort_order,
    created_at: timestamp,
    updated_at: timestamp
  }));

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [existingSettings] = await queryInterface.sequelize.query(
        'SELECT setting_key FROM settings WHERE setting_key = :settingKey',
        { replacements: { settingKey: RADIUS_SETTING_KEY }, transaction }
      );
      const now = new Date();

      if (existingSettings.length === 0) {
        await queryInterface.bulkInsert(
          'settings',
          [
            {
              setting_key: RADIUS_SETTING_KEY,
              setting_value: '100',
              description: RADIUS_SETTING_DESCRIPTION,
              updated_at: now
            }
          ],
          { transaction }
        );
      }

      await queryInterface.createTable(REQUEST_REASON_TABLE, reasonColumns(Sequelize), {
        transaction
      });
      await queryInterface.createTable(REJECTION_REASON_TABLE, reasonColumns(Sequelize), {
        transaction
      });
      await queryInterface.bulkInsert(REQUEST_REASON_TABLE, reasonRows(REQUEST_REASONS, now), {
        transaction
      });
      await queryInterface.bulkInsert(
        REJECTION_REASON_TABLE,
        reasonRows(REJECTION_REASONS, now),
        { transaction }
      );

      await queryInterface.addColumn(
        BOOKINGS_TABLE,
        'request_reason_id',
        { type: Sequelize.INTEGER, allowNull: true },
        { transaction }
      );
      await queryInterface.addColumn(
        BOOKINGS_TABLE,
        'request_other_reason',
        { type: Sequelize.TEXT, allowNull: true },
        { transaction }
      );
      await queryInterface.addColumn(
        BOOKINGS_TABLE,
        'rejection_reason_id',
        { type: Sequelize.INTEGER, allowNull: true },
        { transaction }
      );
      await queryInterface.addColumn(
        BOOKINGS_TABLE,
        'rejection_note',
        { type: Sequelize.TEXT, allowNull: true },
        { transaction }
      );
      await queryInterface.addColumn(
        BOOKINGS_TABLE,
        'radius_snapshot',
        { type: Sequelize.INTEGER, allowNull: true },
        { transaction }
      );

      await queryInterface.addIndex(BOOKINGS_TABLE, ['request_reason_id'], {
        name: 'idx_bookings_request_reason_id',
        transaction
      });
      await queryInterface.addIndex(BOOKINGS_TABLE, ['rejection_reason_id'], {
        name: 'idx_bookings_rejection_reason_id',
        transaction
      });
      await queryInterface.addConstraint(BOOKINGS_TABLE, {
        fields: ['request_reason_id'],
        type: 'foreign key',
        name: 'fk_bookings_wfa_request_reason',
        references: { table: REQUEST_REASON_TABLE, field: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        transaction
      });
      await queryInterface.addConstraint(BOOKINGS_TABLE, {
        fields: ['rejection_reason_id'],
        type: 'foreign key',
        name: 'fk_bookings_wfa_rejection_reason',
        references: { table: REJECTION_REASON_TABLE, field: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.removeConstraint(BOOKINGS_TABLE, 'fk_bookings_wfa_rejection_reason', {
        transaction
      });
      await queryInterface.removeConstraint(BOOKINGS_TABLE, 'fk_bookings_wfa_request_reason', {
        transaction
      });
      await queryInterface.removeIndex(BOOKINGS_TABLE, 'idx_bookings_rejection_reason_id', {
        transaction
      });
      await queryInterface.removeIndex(BOOKINGS_TABLE, 'idx_bookings_request_reason_id', {
        transaction
      });

      for (const column of [
        'radius_snapshot',
        'rejection_note',
        'rejection_reason_id',
        'request_other_reason',
        'request_reason_id'
      ]) {
        await queryInterface.removeColumn(BOOKINGS_TABLE, column, { transaction });
      }

      await queryInterface.dropTable(REJECTION_REASON_TABLE, { transaction });
      await queryInterface.dropTable(REQUEST_REASON_TABLE, { transaction });
      await queryInterface.bulkDelete(
        'settings',
        {
          setting_key: RADIUS_SETTING_KEY,
          description: RADIUS_SETTING_DESCRIPTION
        },
        { transaction }
      );
    });
  }
};
