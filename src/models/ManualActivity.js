'use strict';
const { DataTypes } = require('sequelize');
module.exports = require('../config/database').define('ManualActivity', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  groupId: { type: DataTypes.UUID, allowNull: false, field: 'group_id', references: { model: 'groups', key: 'id' } },
  teacherId: { type: DataTypes.UUID, allowNull: false, field: 'teacher_id', references: { model: 'users', key: 'id' } },
  assignmentId: { type: DataTypes.UUID, field: 'assignment_id', references: { model: 'assignments', key: 'id' } },
  identityKey: { type: DataTypes.STRING(64), unique: true, allowNull: false, field: 'identity_key' },
  title: { type: DataTypes.STRING(255), allowNull: false },
  externalUrl: { type: DataTypes.TEXT, field: 'external_url' },
  activityDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'activity_date' },
  legacyImport: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'legacy_import' }
}, { tableName: 'manual_activities', timestamps: true, underscored: true, createdAt: 'created_at', updatedAt: 'updated_at' });
