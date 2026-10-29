const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
module.exports = sequelize.define('ManualGrade', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  activityId: { type: DataTypes.UUID, allowNull: false, field: 'activity_id', references: { model: 'manual_activities', key: 'id' } },
  version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  studentId: { type: DataTypes.UUID, allowNull: false, field: 'student_id', references: { model: 'users', key: 'id' } },
  groupId: { type: DataTypes.UUID, allowNull: false, field: 'group_id', references: { model: 'groups', key: 'id' } },
  teacherId: { type: DataTypes.UUID, allowNull: false, field: 'teacher_id', references: { model: 'users', key: 'id' } },
  title: { type: DataTypes.STRING(255), allowNull: false },
  externalUrl: { type: DataTypes.TEXT, field: 'external_url' },
  score: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  maxScore: { type: DataTypes.DECIMAL(10, 2), allowNull: false, field: 'max_score' },
  feedback: { type: DataTypes.TEXT },
  activityDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'activity_date' },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
  history: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }
}, { tableName: 'manual_grades', timestamps: true, underscored: true, createdAt: 'created_at', updatedAt: 'updated_at', indexes: [{unique:true, fields:['activity_id','student_id']}] });
