'use strict';

const TABLE_NAME = 'locations';
const LEGACY_PLACEHOLDER = 'Default WFH Location';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn(TABLE_NAME, 'description', {
      type: Sequelize.TEXT,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    // NOT NULL cannot be restored while null rows exist; refill them with the
    // legacy placeholder before tightening the column back.
    await queryInterface.sequelize.query(
      `UPDATE ${TABLE_NAME} SET description = :placeholder WHERE description IS NULL`,
      { replacements: { placeholder: LEGACY_PLACEHOLDER } }
    );

    await queryInterface.changeColumn(TABLE_NAME, 'description', {
      type: Sequelize.TEXT,
      allowNull: false
    });
  }
};
