'use strict';
/**
 * models/index.js — Central model registry and cross-model associations.
 *
 * BUGS FIXED:
 * 1. The old Worksheet.js defined `Worksheet.belongsTo(User, { as: 'creator' })`
 *    inline at the bottom of the file. This file (index.js) defined it again.
 *    Result: the association was registered twice → Sequelize warning + potential
 *    wrong instance resolution in circular-require situations.
 *
 *    FIX: Remove the inline association from Worksheet.js (done). Define it
 *    ONCE here, which is the canonical location for all cross-model associations.
 *
 * 2. All models now have explicit `createdAt: 'created_at'` in their options
 *    blocks, so the global `define` block in database.js no longer needs to
 *    carry the weight alone.
 */

// ─── Load models ──────────────────────────────────────────────────────────────
const User                                      = require('./User');
const Worksheet                                 = require('./Worksheet');
const { Group, GroupMember }                    = require('./Group');
const { Workbook, WorkbookWorksheet, FileUpload } = require('./Workbook');
const Submission                                = require('./Submission');
const Assignment                                = require('./Assignment');

// ─── Worksheet associations ───────────────────────────────────────────────────
// Worksheet creator (teacher who created it)
Worksheet.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
User.hasMany(Worksheet,   { foreignKey: 'createdBy', as: 'worksheets' });

// ─── User ↔ Group ─────────────────────────────────────────────────────────────
// Student belongs to a group via group_id on users table
User.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(User,   { foreignKey: 'groupId', as: 'students' });

// Student has a teacher via teacher_id on users table
User.belongsTo(User, { foreignKey: 'teacherId', as: 'myTeacher' });
User.hasMany(User,   { foreignKey: 'teacherId', as: 'myStudents' });

// Teacher has many groups
User.hasMany(Group, { foreignKey: 'teacherId', as: 'teacherGroups' });

// ─── Assignment associations ──────────────────────────────────────────────────
Assignment.belongsTo(Worksheet, { foreignKey: 'worksheetId', as: 'worksheet' });
Worksheet.hasMany(Assignment,   { foreignKey: 'worksheetId', as: 'assignments' });

Assignment.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(Assignment,   { foreignKey: 'groupId', as: 'assignments' });

Assignment.belongsTo(User, { foreignKey: 'assignedBy', as: 'assigner' });

// ─── Submission associations ──────────────────────────────────────────────────
Submission.belongsTo(User,      { foreignKey: 'studentId',  as: 'student' });
User.hasMany(Submission,        { foreignKey: 'studentId',  as: 'submissions' });

Submission.belongsTo(Worksheet, { foreignKey: 'worksheetId', as: 'worksheet' });

// ─── Workbook ↔ Worksheet (M:N) ───────────────────────────────────────────────
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

// ─── Exports ──────────────────────────────────────────────────────────────────
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
