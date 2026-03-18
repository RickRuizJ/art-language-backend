'use strict';
/**
 * models/User.js
 *
 * BUGS FIXED:
 * Same timestamp issue as Worksheet: the model uses a custom options block
 * which can override the global `define` block. Adding explicit
 * `createdAt: 'created_at'` and `updatedAt: 'updated_at'` ensures Sequelize
 * always maps to the correct snake_case DB columns.
 */

const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },

  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },

  password: {
    type: DataTypes.STRING,
    allowNull: false
  },

  firstName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'first_name'
  },

  lastName: {
    type: DataTypes.STRING,
    allowNull: false,
    field: 'last_name'
  },

  role: {
    type: DataTypes.ENUM('admin', 'teacher', 'student'),
    allowNull: false,
    defaultValue: 'student'
  },

  avatarUrl: {
    type: DataTypes.STRING,
    field: 'avatar_url'
  },

  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_active'
  },

  groupId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'group_id'
  },

  teacherId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'teacher_id'
  }

}, {
  tableName: 'users',
  timestamps: true,
  underscored: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',

  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        user.password = await bcrypt.hash(user.password, 10);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        user.password = await bcrypt.hash(user.password, 10);
      }
    }
  }
});

User.prototype.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

User.prototype.toJSON = function () {
  const values = Object.assign({}, this.get());
  delete values.password;
  return values;
};

module.exports = User;
