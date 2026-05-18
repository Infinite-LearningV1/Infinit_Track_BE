'use strict';

const indexExists = async (queryInterface, tableName, indexName, transaction) => {
  const [rows] = await queryInterface.sequelize.query(`SHOW INDEX FROM \`${tableName}\``, {
    transaction
  });

  return rows.some((row) => row.Key_name === indexName);
};

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      if (!(await indexExists(queryInterface, 'attendance', 'idx_attendance_date', transaction))) {
        await queryInterface.addIndex('attendance', ['attendance_date'], {
          name: 'idx_attendance_date',
          transaction
        });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('attendance', 'idx_attendance_date');
  }
};
