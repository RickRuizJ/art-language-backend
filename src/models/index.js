'use strict';
/**
 * Central model registry y asociaciones
 * IMPORTANTE: Group.js ya define sus propias asociaciones internas.
 * Aquí solo se definen las asociaciones CRUZADAS entre modelos distintos.
 */

// ─── Cargar modelos ───────────────────────────────────────────────────────────
const User            = require('./User');
const Worksheet       = require('./Worksheet');
const { Group, GroupMember } = require('./Group');
const { Workbook, WorkbookWorksheet, FileUpload } = require('./Workbook');
const Submission      = require('./Submission');
const Assignment      = require('./Assignment');

// ─── Asociaciones nuevas (no definidas en ningún modelo individual) ───────────

// User → Group: estudiante pertenece a un grupo (via group_id en users)
User.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(User,   { foreignKey: 'groupId', as: 'students' });

// User → User: estudiante tiene un profesor (via teacher_id en users)
User.belongsTo(User, { foreignKey: 'teacherId', as: 'myTeacher' });
User.hasMany(User,   { foreignKey: 'teacherId', as: 'myStudents' });

// User → Group: profesor tiene muchos grupos
User.hasMany(Group, { foreignKey: 'teacherId', as: 'teacherGroups' });

// Assignment ↔ Worksheet
Assignment.belongsTo(Worksheet, { foreignKey: 'worksheetId', as: 'worksheet' });
Worksheet.hasMany(Assignment,   { foreignKey: 'worksheetId', as: 'assignments' });

// Assignment ↔ Group
Assignment.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(Assignment,   { foreignKey: 'groupId', as: 'assignments' });

// Assignment ↔ User (profesor que asignó)
Assignment.belongsTo(User, { foreignKey: 'assignedBy', as: 'assigner' });

// Submission ↔ Student
Submission.belongsTo(User, { foreignKey: 'studentId', as: 'student' });
User.hasMany(Submission,   { foreignKey: 'studentId', as: 'submissions' });

// Submission ↔ Worksheet
Submission.belongsTo(Worksheet, { foreignKey: 'worksheetId', as: 'worksheet' });

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

// ─── Exportar ─────────────────────────────────────────────────────────────────
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
