'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('photos', 'storage_provider', {
      type: Sequelize.STRING(32),
      allowNull: true,
      defaultValue: null
    });

    await queryInterface.addColumn('photos', 'storage_key', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('photos', 'storage_key');
    await queryInterface.removeColumn('photos', 'storage_provider');
  }
};
