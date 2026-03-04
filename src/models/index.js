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
const Assignment = require('./Assignment');

// ─── Step 2: Define associations ──────────────────────────────────────────────

// Workbook ↔ Worksheet (M:N)
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

// Assignment ↔ Worksheet (N:1)
Assignment.belongsTo(Worksheet, {
  foreignKey: 'worksheetId',
  as: 'worksheet'
});

Worksheet.hasMany(Assignment, {
  foreignKey: 'worksheetId',
  as: 'assignments'
});

// Assignment ↔ Group (N:1)
Assignment.belongsTo(Group, {
  foreignKey: 'groupId',
  as: 'group'
});

Group.hasMany(Assignment, {
  foreignKey: 'groupId',
  as: 'assignments'
});

// Assignment ↔ User (assignedBy)
Assignment.belongsTo(User, {
  foreignKey: 'assignedBy',
  as: 'assigner'
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
  Submission,
  Assignment
};
