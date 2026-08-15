import { DataTypes } from 'sequelize';

import sequelize from '../config/database.js';

const Booking = sequelize.define(
  'Booking',
  {
    booking_id: {
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
    schedule_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    location_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'locations',
        key: 'location_id'
      }
    },
    status: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'booking_status',
        key: 'id_booking_status'
      }
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    approved_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id_users'
      }
    },
    processed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    suitability_score: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true
    },
    suitability_label: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    request_reason_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'wfa_request_reasons',
        key: 'id'
      }
    },
    request_other_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    rejection_reason_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'wfa_rejection_reasons',
        key: 'id'
      }
    },
    rejection_note: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    radius_snapshot: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    wfa_scoring_snapshot: {
      type: DataTypes.JSON,
      allowNull: true
    },
    rejection_reason: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  },
  {
    tableName: 'bookings',
    timestamps: false // karena menggunakan created_at custom
  }
);

export default Booking;
