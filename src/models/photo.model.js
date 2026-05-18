import { DataTypes } from 'sequelize';

import sequelize from '../config/database.js';

const Photo = sequelize.define(
  'Photo',
  {
    id_photos: {
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
    photo_url: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    storage_provider: {
      type: DataTypes.STRING(32),
      allowNull: true,
      defaultValue: null
    },
    storage_key: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null
    },
    public_id: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    photo_updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: 'photos',
    timestamps: false
  }
);

export default Photo;
