'use strict';

const indexExists = async (queryInterface, tableName, indexName, transaction) => {
  const [rows] = await queryInterface.sequelize.query(`SHOW INDEX FROM \`${tableName}\``,
    { transaction }
  );

  return rows.some((row) => row.Key_name === indexName);
};

/** @type {import('sequelize-cli').Migration} */
const migration = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Step 1: Check and clean duplicate attendance records
      const [attendanceDupes] = await queryInterface.sequelize.query(
        `SELECT user_id, attendance_date, COUNT(*) as cnt
         FROM attendance
         GROUP BY user_id, attendance_date
         HAVING cnt > 1`,
        { transaction }
      );

      if (attendanceDupes.length > 0) {
        console.warn(
          'Found duplicate attendance records:',
          JSON.stringify(attendanceDupes)
        );
        // Keep only the latest record for each (user_id, attendance_date) pair
        await queryInterface.sequelize.query(
          `
            DELETE a1 FROM attendance a1
            INNER JOIN attendance a2
            ON a1.user_id = a2.user_id
            AND a1.attendance_date = a2.attendance_date
            AND a1.id_attendance < a2.id_attendance
          `,
          { transaction }
        );
        console.log('Duplicate attendance records cleaned up (kept latest per user+date)');
      }

      // Step 2: Add unique constraint on attendance (user_id, attendance_date)
      if (!(await indexExists(queryInterface, 'attendance', 'uq_attendance_user_date', transaction))) {
        await queryInterface.addIndex('attendance', ['user_id', 'attendance_date'], {
          unique: true,
          name: 'uq_attendance_user_date',
          transaction
        });
      }

      // Step 3: Add composite index on bookings for lookup performance
      // Note: NOT unique — MySQL lacks partial unique indexes,
      // and rejected bookings must allow resubmission for the same date
      if (
        !(await indexExists(queryInterface, 'bookings', 'idx_bookings_user_schedule', transaction))
      ) {
        await queryInterface.addIndex('bookings', ['user_id', 'schedule_date'], {
          name: 'idx_bookings_user_schedule',
          transaction
        });
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('attendance', 'uq_attendance_user_date');
    await queryInterface.removeIndex('bookings', 'idx_bookings_user_schedule');
  }
};

export default migration;

if (typeof module !== 'undefined') {
  module.exports = migration;
}
