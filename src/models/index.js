/**
 * Central model registry and associations
 * 
 * CRITICAL: All models must be loaded BEFORE defining associations
 * to avoid circular dependency issues.
 */

// ─── Step 1: Load all models ──────────────────────────────────────────────────
const User = require('./User');
const Worksheet = require('./Worksheet');
const { Group, GroupMember } = require('./Group');
const { Workbook, WorkbookWorksheet, FileUpload } = require('./Workbook');
const Submission = require('./Submission');

// ─── Step 2: Define M:N associations ──────────────────────────────────────────
// These MUST be defined after all models are loaded to ensure both sides exist

Workbook.belongsToMany(Worksheet, {
  through: WorkbookWorksheet,
  foreignKey: 'workbookId',
  otherKey: 'worksheetId',
  as: 'worksheets'
});

Worksheet.belongsToMany(Workbook, {
  through: WorkbookWorksheet,
  foreignKey: 'worksheetId',
  otherKey: 'workbookId',
  as: 'workbooks'
});

// ─── Export all models ────────────────────────────────────────────────────────
module.exports = {
  User,
  Worksheet,
  Group,
  GroupMember,
  Workbook,
  WorkbookWorksheet,
  FileUpload,
  Submission
};
