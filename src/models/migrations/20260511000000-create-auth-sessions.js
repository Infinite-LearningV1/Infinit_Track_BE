'use strict';

/** @type {import('sequelize-cli').Migration} */
const migration = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'auth_sessions',
        {
          session_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            primaryKey: true,
            autoIncrement: true
          },
          user_id: {
            type: Sequelize.INTEGER,
            allowNull: false,
            references: {
              model: 'users',
              key: 'id_users'
            },
            onUpdate: 'CASCADE',
            onDelete: 'CASCADE'
          },
          refresh_jti: {
            type: Sequelize.STRING(255),
            allowNull: false
          },
          client_type: {
            type: Sequelize.STRING(20),
            allowNull: false
          },
          user_agent: {
            type: Sequelize.TEXT,
            allowNull: true
          },
          last_activity_at: {
            type: Sequelize.DATE,
            allowNull: false
          },
          expires_at: {
            type: Sequelize.DATE,
            allowNull: false
          },
          revoked_at: {
            type: Sequelize.DATE,
            allowNull: true
          },
          revocation_reason: {
            type: Sequelize.STRING(255),
            allowNull: true
          },
          created_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW
          },
          updated_at: {
            type: Sequelize.DATE,
            allowNull: false,
            defaultValue: Sequelize.NOW
          }
        },
        { transaction }
      );

      await queryInterface.addIndex('auth_sessions', ['refresh_jti'], {
        unique: true,
        name: 'uq_auth_sessions_refresh_jti',
        transaction
      });

      await queryInterface.addIndex('auth_sessions', ['user_id'], {
        name: 'idx_auth_sessions_user_id',
        transaction
      });

      await queryInterface.addIndex('auth_sessions', ['user_id', 'revoked_at', 'expires_at'], {
        name: 'idx_auth_sessions_active_lookup',
        transaction
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('auth_sessions');
  }
};

export default migration;

if (typeof module !== 'undefined') {
  module.exports = migration;
}
