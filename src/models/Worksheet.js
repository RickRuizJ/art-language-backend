const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

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
    type: DataTypes.TEXT
  },
  subject: {
    type: DataTypes.STRING
  },
  gradeLevel: {
    type: DataTypes.STRING,
    field: 'grade_level'
  },
  difficulty: {
    type: DataTypes.ENUM('beginner', 'intermediate', 'advanced'),
    defaultValue: 'beginner'
  },
  estimatedTime: {
    type: DataTypes.INTEGER, // in minutes
    field: 'estimated_time'
  },
  questions: {
    type: DataTypes.JSONB,
    allowNull: false,
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
    references: {
      model: 'users',
      key: 'id'
    }
  },
  isPublished: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_published'
  }
}, {
  tableName: 'worksheets'
});

module.exports = Worksheet;
