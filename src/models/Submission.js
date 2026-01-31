const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Submission = sequelize.define('Submission', {
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
    }
  },
  studentId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'student_id',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  answers: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: []
  },
  score: {
    type: DataTypes.DECIMAL(5, 2)
  },
  maxScore: {
    type: DataTypes.INTEGER,
    field: 'max_score'
  },
  status: {
    type: DataTypes.ENUM('pending', 'graded', 'reviewed'),
    defaultValue: 'pending'
  },
  feedback: {
    type: DataTypes.TEXT
  },
  gradedBy: {
    type: DataTypes.UUID,
    field: 'graded_by',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  submittedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'submitted_at'
  },
  gradedAt: {
    type: DataTypes.DATE,
    field: 'graded_at'
  }
}, {
  tableName: 'submissions',
  timestamps: false
});

module.exports = Submission;
