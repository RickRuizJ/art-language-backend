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
    references: {
      model: 'worksheets',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  groupId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'group_id',
    references: {
      model: 'groups',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  assignedBy: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'assigned_by',
    references: {
      model: 'users',
      key: 'id'
    }
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
