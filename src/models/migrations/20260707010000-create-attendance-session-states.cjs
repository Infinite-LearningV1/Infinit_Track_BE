'use strict';

const TABLE_NAME = 'attendance_session_states';

const SESSION_STATES = [
  {
    state_key: 'not_started',
    state_label: 'Not Started',
    description: 'User has not checked in today',
    sort_order: 1,
    is_active: true
  },
  {
    state_key: 'active',
    state_label: 'Active Session',
    description: 'User has checked in and has not checked out yet',
    sort_order: 2,
    is_active: true
  },
  {
    state_key: 'completed',
    state_label: 'Completed Today',
    description: 'User has checked in and checked out today',
    sort_order: 3,
    is_active: true
  },
  {
    state_key: 'unavailable',
    state_label: 'Unavailable',
    description: 'Attendance is unavailable due to business rules such as holiday, closed window, or other restrictions',
    sort_order: 4,
    is_active: true
  }
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(TABLE_NAME, {
      id_attendance_session_state: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true
      },
      state_key: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true
      },
      state_label: {
        type: Sequelize.STRING(100),
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });

    const now = new Date();
    await queryInterface.bulkInsert(
      TABLE_NAME,
      SESSION_STATES.map((state) => ({
        ...state,
        created_at: now,
        updated_at: now
      }))
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable(TABLE_NAME);
  }
};
