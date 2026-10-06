'use strict';
/**
 * models/Submission.js
 *
 * BUGS FIXED:
 * 1. submissionController.js orders by `submittedAt` (camelCase JS attr) which
 *    is fine because that IS the JS attribute name — Sequelize translates it
 *    to the `submitted_at` column via `field` mapping. However the attribute
 *    `worksheetId` was used in `findOne({ where: { worksheetId, studentId } })`
 *    — Sequelize uses the JS attribute name in where clauses, so this is correct.
 *
 * 2. No timestamps: this model correctly has `timestamps: false` — it uses
 *    `submittedAt` as a manual date field. No change needed here.
 *
 * This file is included for completeness and to confirm it is correct as-is.
 */

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
    type: DataTypes.ENUM('pending', 'submitted', 'graded', 'reviewed'),
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
  },
  // SPRINT 0 ADDITION — multiple configurable attempts (see migration
  // 20260721_sprint0_stabilization.js). 1-indexed per (worksheetId, studentId).
  attemptNumber: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    field: 'attempt_number'
  },
  // SPRINT 0 ADDITION — enables the "tiempo promedio" analytics requirement,
  // which was impossible before (only submittedAt existed, no duration).
  timeSpentSeconds: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'time_spent_seconds'
  }
}, {
  tableName: 'submissions',
  timestamps: false,
  indexes: [
    // Every attempt-limit check and "my submissions for this worksheet" query
    // filters on this pair — was previously an unindexed lookup.
    { fields: ['worksheet_id', 'student_id'] },
    { unique: true, fields: ['worksheet_id', 'student_id', 'attempt_number'] }
  ]
});

module.exports = Submission;
