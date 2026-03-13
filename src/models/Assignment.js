'use strict';
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
  // FK al grupo — columna ya existe en la BD
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
  underscored: true
});

module.exports = Assignment;
