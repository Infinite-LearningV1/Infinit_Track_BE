import { DataTypes } from 'sequelize';

import sequelize from '../config/database.js';

const AttendanceSessionState = sequelize.define(
  'AttendanceSessionState',
  {
    id_attendance_session_state: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    state_key: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    state_label: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false
    }
  },
  {
    tableName: 'attendance_session_states',
    timestamps: false
  }
);

export default AttendanceSessionState;
