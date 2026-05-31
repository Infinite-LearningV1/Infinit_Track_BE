import { DataTypes } from 'sequelize';

import sequelize from '../config/database.js';

const AuthSession = sequelize.define(
  'AuthSession',
  {
    session_id: {
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
    refresh_jti: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    client_type: {
      type: DataTypes.STRING(20),
      allowNull: false
    },
    user_agent: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    last_activity_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false
    },
    revoked_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    revocation_reason: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  },
  {
    tableName: 'auth_sessions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
);

export default AuthSession;
