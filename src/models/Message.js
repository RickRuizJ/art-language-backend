'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Message = sequelize.define('Message', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  senderId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'sender_id',
    references: { model: 'users', key: 'id' }
  },
  recipientId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'recipient_id',
    references: { model: 'users', key: 'id' }
  },
  groupId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'group_id',
    references: { model: 'groups', key: 'id' }
  },
  subject: {
    type: DataTypes.STRING(180),
    allowNull: true
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
    validate: { notEmpty: true }
  },
  isRead: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_read'
  },
  readAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'read_at'
  }
}, {
  tableName: 'messages',
  timestamps: true,
  underscored: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['recipient_id', 'created_at'] },
    { fields: ['sender_id', 'created_at'] },
    { fields: ['group_id'] },
    { fields: ['recipient_id', 'is_read'] }
  ]
});

module.exports = Message;
