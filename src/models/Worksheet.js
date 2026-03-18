'use strict';
/**
 * models/Worksheet.js
 *
 * BUGS FIXED:
 *
 * 1. PRIMARY BUG — SequelizeDatabaseError: column "Worksheet"."createdAt" does not exist
 *    Root cause: The model had `underscored: true` in its options, but Sequelize's
 *    global `define` block in database.js ALSO sets `underscored: true` with
 *    `createdAt: 'created_at'`. However when a model-level option block is present,
 *    it OVERRIDES the global define block rather than merging.
 *
 *    The `underscored: true` in the model options was not including explicit
 *    `createdAt` / `updatedAt` field remappings, so Sequelize fell back to
 *    its default camelCase names (`createdAt`, `updatedAt`) in SQL queries,
 *    but the DB columns are `created_at` / `updated_at` → crash.
 *
 *    FIX: Explicitly declare `createdAt: 'created_at'` and `updatedAt: 'updated_at'`
 *         in the model options so the mapping is unambiguous.
 *
 * 2. SECONDARY BUG — duplicate association / circular require
 *    The original file required User at the bottom and defined
 *    `Worksheet.belongsTo(User, { foreignKey: 'created_by', as: 'creator' })`
 *    INSIDE the model file. But models/index.js also sets up cross-model
 *    associations. This causes the association to be registered twice (Sequelize
 *    warns but allows it) AND creates a circular require chain that can silently
 *    shadow the real User module.
 *
 *    FIX: Remove the inline association. All Worksheet associations are now
 *    defined in models/index.js only (the canonical place).
 */

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
  underscored: true,
  // FIX: Explicitly map timestamps so Sequelize never falls back to camelCase
  // column names, regardless of how the global define block is configured.
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

// NOTE: Worksheet.belongsTo(User, { as: 'creator' }) is defined in models/index.js
// DO NOT add it here — it would create a duplicate association and a circular require.

module.exports = Worksheet;
