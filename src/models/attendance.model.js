import { DataTypes } from 'sequelize';

import sequelize from '../config/database.js';

const Attendance = sequelize.define(
  'Attendance',
  {
    id_attendance: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id_users'
      }
    },
    category_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'attendance_categories',
        key: 'id_attendance_categories'
      }
    },
    status_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'attendance_statuses',
        key: 'id_attendance_status'
      }
    },
    location_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'locations',
        key: 'location_id'
      }
    },
    booking_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'bookings',
        key: 'booking_id'
      }
    },
    time_in: {
      type: DataTypes.DATE,
      allowNull: false
    },
    time_out: {
      type: DataTypes.DATE,
      allowNull: true
    },
    work_hour: {
      type: DataTypes.FLOAT(5, 2),
      allowNull: true
    },
    attendance_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: ''
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
    tableName: 'attendance',
    timestamps: false, // karena menggunakan created_at dan updated_at custom
    indexes: [
      {
        name: 'idx_attendance_date',
        fields: ['attendance_date']
      },
      {
        name: 'uq_attendance_user_date',
        fields: ['user_id', 'attendance_date'],
        unique: true
      }
    ]
  }
);

export default Attendance;
