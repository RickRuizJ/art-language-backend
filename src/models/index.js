// =====================================================
// AGREGAR A: backend/src/models/index.js
// =====================================================

const Assignment = require('./Assignment');
const Worksheet = require('./Worksheet');
const Group = require('./Group');
const User = require('./User');

// ─── Assignment Associations ──────────────────────────────────

// Assignment belongs to Worksheet
Assignment.belongsTo(Worksheet, {
  foreignKey: 'worksheetId',
  as: 'worksheet'
});

// Assignment belongs to Group
Assignment.belongsTo(Group, {
  foreignKey: 'groupId',
  as: 'group'
});

// Assignment belongs to User (assignedBy)
Assignment.belongsTo(User, {
  foreignKey: 'assignedBy',
  as: 'assigner'
});

// Worksheet has many Assignments
Worksheet.hasMany(Assignment, {
  foreignKey: 'worksheetId',
  as: 'assignments'
});

// Group has many Assignments
Group.hasMany(Assignment, {
  foreignKey: 'groupId',
  as: 'assignments'
});

// ──────────────────────────────────────────────────────────────

module.exports = {
  // ... existing exports
  Assignment
};
