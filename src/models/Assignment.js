'use strict';
/**
 * models/Assignment.js
 *
 * BUGS FIXED:
 * Same timestamp issue: `underscored: true` alone doesn't map timestamps when
 * a model-level options block is present. Added explicit createdAt/updatedAt.
 */

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Assignment = sequelize.define('Assignment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  worksheetId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'worksheet_id',
    references: { model: 'worksheets', key: 'id' }
  },
  groupId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'group_id',
    references: { model: 'groups', key: 'id' }
  },
  assignedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'assigned_by',
    references: { model: 'users', key: 'id' }
  },
  dueDate: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'due_date'
  },
  instructions: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_active'
  }
}, {
  tableName: 'assignments',
  underscored: true,
  timestamps: true,
  // FIX: Explicit timestamp column mapping
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Assignment;
