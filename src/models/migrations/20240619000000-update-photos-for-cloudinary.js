'use strict';

/** @type {import('sequelize-cli').Migration} */
const migration = {
  async up() {
    // Historical alignment stub: baseline schema already uses photo_url and public_id.
  },

  async down() {
    // No rollback needed for historical alignment stub.
  }
};

export default migration;

if (typeof module !== 'undefined') {
  module.exports = migration;
}
