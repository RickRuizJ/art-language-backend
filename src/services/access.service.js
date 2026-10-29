'use strict';
const { Op } = require('sequelize');
const { User, Group, GroupMember } = require('../models');
const db = require('../config/database');
const { fail, UUID } = require('./validation.service');
const { record } = require('./audit.service');
exports.groupScope = actor => actor.role === 'admin' ? {} : { teacherId: actor.id };
exports.groupAccess = (actor, id, transaction) => UUID.test(id || '') ? Group.findOne({ where: { id, ...exports.groupScope(actor) }, transaction }) : null;
exports.groupIds = async (studentId, directGroupId, transaction) => [...new Set([
  directGroupId, ...(await GroupMember.findAll({ where: { studentId }, attributes: ['groupId'], transaction })).map(m => m.groupId)
].filter(Boolean))];
exports.studentAccess = async (actor, studentId, transaction, lock = false) => {
  if (!UUID.test(studentId || '')) return null;
  const student = await User.findOne({ where: { id: studentId, role: 'student' }, transaction, ...(lock && transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
  if (!student || actor.role === 'admin') return student;
  const ids = await exports.groupIds(student.id, student.groupId, transaction);
  return ids.length && await Group.findOne({ where: { id: { [Op.in]: ids }, teacherId: actor.id, isActive: { [Op.not]: false } }, transaction }) ? student : null;
};
exports.rosterWhere = async (actor, transaction) => {
  if (actor.role === 'admin') return { role: 'student' };
  const groups = await Group.findAll({ where: { ...exports.groupScope(actor), isActive: { [Op.not]: false } }, attributes: ['id'], transaction });
  const ids = groups.map(g => g.id);
  const members = ids.length ? await GroupMember.findAll({ where: { groupId: { [Op.in]: ids } }, attributes: ['studentId'], transaction }) : [];
  return { role: 'student', [Op.or]: [{ groupId: { [Op.in]: ids } }, { id: { [Op.in]: members.map(m => m.studentId) } }] };
};
exports.removeMember = (actor, groupId, studentId) => db.transaction(async transaction => {
  const student = await exports.studentAccess(actor, studentId, transaction, true);
  const group = await exports.groupAccess(actor, groupId, transaction);
  if (!student || !group) throw fail('Student or group not found in your authorized scope.', 404);
  await GroupMember.destroy({ where: { groupId, studentId }, transaction });
  if (student.groupId === groupId) student.groupId = null;
  const remaining = await exports.groupIds(studentId, student.groupId, transaction);
  if (student.teacherId) {
    const supervised = remaining.length && await Group.findOne({ where: { id: { [Op.in]: remaining }, teacherId: student.teacherId }, transaction });
    if (!supervised) student.teacherId = null;
  }
  await student.save({ transaction });
  await record(actor.id, 'student.group_removed', studentId, { groupId }, transaction);
});
exports.addMembers = (actor, groupId, studentIds) => db.transaction(async transaction => {
  if (!Array.isArray(studentIds) || !studentIds.length || studentIds.length > 100 || studentIds.some(id => !UUID.test(id))) throw fail('Provide 1 to 100 valid student IDs.');
  const group = await exports.groupAccess(actor, groupId, transaction);
  if (!group || !group.isActive) throw fail('Active group not found.', 404);
  for (const id of [...new Set(studentIds)].sort()) {
    if (!await exports.studentAccess(actor, id, transaction, true)) throw fail('Student is outside your authorized scope.', 403);
    await GroupMember.findOrCreate({ where: { groupId, studentId: id }, transaction });
    await record(actor.id, 'student.group_added', id, { groupId }, transaction);
  }
});
