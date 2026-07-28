import { DataTypes } from 'sequelize';

import sequelize from '../config/database.js';

const WfaRequestReason = sequelize.define(
  'WfaRequestReason',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    label: { type: DataTypes.STRING(120), allowNull: false },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    is_other: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false }
  },
  {
    tableName: 'wfa_request_reasons',
    timestamps: false
  }
);

export default WfaRequestReason;
