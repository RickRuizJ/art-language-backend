'use strict';
const { DataTypes } = require('sequelize');
module.exports = require('../config/database').define('AuditEvent', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  actorId: { type: DataTypes.UUID, field: 'actor_id', references: { model: 'users', key: 'id' } },
  subjectId: { type: DataTypes.UUID, field: 'subject_id' },
  action: { type: DataTypes.STRING(80), allowNull: false },
  metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  createdAt: { type: DataTypes.DATE, field: 'created_at', defaultValue: DataTypes.NOW }
}, { tableName: 'audit_events', timestamps: false });
