'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Worksheet = sequelize.define('Worksheet', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  subject: {
    type: DataTypes.STRING,
    allowNull: true
  },
  gradeLevel: {
    type: DataTypes.STRING,
    allowNull: true,
    field: 'grade_level'
  },
  difficulty: {
    type: DataTypes.ENUM('beginner', 'intermediate', 'advanced'),
    defaultValue: 'beginner'
  },
  estimatedTime: {
    type: DataTypes.INTEGER,
    defaultValue: 30,
    field: 'estimated_time'
  },
  // Las preguntas se guardan como JSONB en PostgreSQL
  questions: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  autoGrade: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'auto_grade'
  },
  passScore: {
    type: DataTypes.INTEGER,
    defaultValue: 70,
    field: 'pass_score'
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'created_by',
    references: { model: 'users', key: 'id' }
  },
  isPublished: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_published'
  }
}, {
  tableName: 'worksheets',
  underscored: true
});

module.exports = Worksheet;
