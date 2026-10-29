'use strict';
const { DataTypes } = require('sequelize');
module.exports = require('../config/database').define('EmailJob', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  userId: { type: DataTypes.UUID, field: 'user_id', references: { model: 'users', key: 'id' } },
  authVersion: {type:DataTypes.INTEGER,allowNull:false,defaultValue:0,field:'auth_version'},
  status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  availableAt: { type: DataTypes.DATE, field: 'available_at', defaultValue: DataTypes.NOW },
  lockedAt: { type: DataTypes.DATE, field: 'locked_at' },
  errorCode: { type: DataTypes.STRING(40), field: 'error_code' }
}, { tableName: 'email_jobs', timestamps: true, underscored: true, createdAt: 'created_at', updatedAt: 'updated_at' });
