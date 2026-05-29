'use strict';

const getExistingIndexNames = async (queryInterface, tableName, transaction) => {
  const [rows] = await queryInterface.sequelize.query(`SHOW INDEX FROM \`${tableName}\``, {
    transaction
  });

  return new Set(rows.map((row) => row.Key_name));
};

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const existingIndexNames = await getExistingIndexNames(queryInterface, 'attendance', transaction);

      if (
        !existingIndexNames.has('idx_attendance_user_date') &&
        !existingIndexNames.has('uq_attendance_user_date')
      ) {
        await queryInterface.addIndex('attendance', ['user_id', 'attendance_date'], {
          name: 'idx_attendance_user_date',
          transaction
        });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const existingIndexNames = await getExistingIndexNames(queryInterface, 'attendance', transaction);

      if (existingIndexNames.has('idx_attendance_user_date')) {
        await queryInterface.removeIndex('attendance', 'idx_attendance_user_date', { transaction });
      }
    });
  }
};
