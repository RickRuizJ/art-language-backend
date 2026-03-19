'use strict';
/**
 * controllers/studentController.js
 *
 * BUG FIXED — assignments not showing on student dashboard:
 *
 * The controller gated ALL assignment loading on `if (student.groupId)`,
 * meaning it only looked at the `group_id` column on the `users` table.
 * However, students join groups via the `group_members` junction table —
 * `users.group_id` is frequently NULL even when the student IS in a group.
 *
 * FIX: When `student.groupId` is null, query `GroupMember` to find the
 * student's group(s) and use that groupId for all downstream queries.
 * This applies to getStudentDashboard, getMyGroup, and getMyAssignments.
 *
 * Also kept: `sequelize.literal('due_date ASC NULLS LAST')` for correct
 * Postgres ordering (plain array syntax rejects multi-word directions).
 */

const sequelize = require('../config/database');
const { User, Group, Assignment, Worksheet, Submission, GroupMember } = require('../models');

/**
 * Resolve the effective groupId for a student.
 * Checks users.group_id first; falls back to group_members table.
 * Returns null if the student is not in any group.
 */
async function resolveGroupId(studentId, directGroupId) {
  if (directGroupId) return directGroupId;

  // Fall back: look up the most recent group_members entry
  const membership = await GroupMember.findOne({
    where: { studentId },
    order: [['joined_at', 'DESC']],
    attributes: ['groupId']
  });

  return membership?.groupId || null;
}

/**
 * GET /api/students/dashboard
 */
const getStudentDashboard = async (req, res) => {
  try {
    const studentId = req.user.id;

    // 1. Load student with direct group association
    const student = await User.findByPk(studentId, {
      attributes: ['id', 'firstName', 'lastName', 'email', 'avatarUrl', 'groupId'],
      include: [{
        model: Group,
        as: 'group',
        required: false,
        attributes: ['id', 'name', 'description', 'subject', 'gradeLevel'],
        include: [{
          model: User,
          as: 'teacher',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl']
        }]
      }]
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    // 2. Resolve groupId — users.group_id OR group_members table
    const effectiveGroupId = await resolveGroupId(studentId, student.groupId);

    let assignments = [];
    let stats       = { total: 0, completed: 0, pending: 0, avgScore: null };
    let groupData   = student.group || null;

    if (effectiveGroupId) {
      // Load group info if not already attached via users.group_id
      if (!groupData) {
        groupData = await Group.findByPk(effectiveGroupId, {
          attributes: ['id', 'name', 'description', 'subject', 'gradeLevel'],
          include: [{
            model: User,
            as: 'teacher',
            attributes: ['id', 'firstName', 'lastName', 'avatarUrl']
          }]
        });
      }

      // 3. Assignments for the group
      const rawAssignments = await Assignment.findAll({
        where: { groupId: effectiveGroupId, isActive: true },
        include: [{
          model: Worksheet,
          as: 'worksheet',
          attributes: ['id', 'title', 'description']
        }],
        order: [sequelize.literal('due_date ASC NULLS LAST')]
      });

      // 4. Student submissions
      const submissions = await Submission.findAll({
        where: { studentId },
        attributes: ['id', 'worksheetId', 'status', 'score', 'maxScore', 'submittedAt']
      });

      const subMap = {};
      submissions.forEach(s => { subMap[s.worksheetId] = s; });

      assignments = rawAssignments.map(a => {
        const sub = subMap[a.worksheetId] || null;
        return {
          ...a.toJSON(),
          submission:       sub,
          submissionStatus: sub ? sub.status : 'pending'
        };
      });

      // 5. Stats
      const completed = submissions.filter(s =>
        ['submitted', 'graded', 'reviewed'].includes(s.status)
      );
      const graded = submissions.filter(s => s.status === 'graded' && s.score !== null);

      stats.total     = assignments.length;
      stats.completed = completed.length;
      stats.pending   = stats.total - stats.completed;

      if (graded.length > 0) {
        const sum = graded.reduce((acc, s) =>
          acc + (s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0), 0
        );
        stats.avgScore = Math.round(sum / graded.length);
      }
    }

    // Build student object with resolved group attached
    const studentJson = student.toJSON();
    if (!studentJson.group && groupData) {
      studentJson.group = groupData instanceof Object && typeof groupData.toJSON === 'function'
        ? groupData.toJSON()
        : groupData;
    }

    return res.status(200).json({
      student: studentJson,
      assignments,
      stats
    });
  } catch (err) {
    console.error('getStudentDashboard error:', err);
    return res.status(500).json({ message: 'Internal error', error: err.message });
  }
};

/**
 * GET /api/students/group
 */
const getMyGroup = async (req, res) => {
  try {
    const studentId = req.user.id;

    const student = await User.findByPk(studentId, {
      attributes: ['id', 'firstName', 'groupId'],
      include: [{
        model: Group,
        as: 'group',
        required: false,
        attributes: ['id', 'name', 'description', 'subject', 'gradeLevel', 'joinCode'],
        include: [{
          model: User,
          as: 'teacher',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl']
        }]
      }]
    });

    // If direct group association exists, return it
    if (student?.group) {
      return res.status(200).json({ group: student.group });
    }

    // Fall back to group_members
    const effectiveGroupId = await resolveGroupId(studentId, student?.groupId);
    if (!effectiveGroupId) {
      return res.status(200).json({ group: null, message: 'No group assigned.' });
    }

    const group = await Group.findByPk(effectiveGroupId, {
      attributes: ['id', 'name', 'description', 'subject', 'gradeLevel', 'joinCode'],
      include: [{
        model: User,
        as: 'teacher',
        attributes: ['id', 'firstName', 'lastName', 'avatarUrl']
      }]
    });

    return res.status(200).json({ group: group || null });
  } catch (err) {
    console.error('getMyGroup error:', err);
    return res.status(500).json({ message: 'Internal error', error: err.message });
  }
};

/**
 * GET /api/students/assignments
 */
const getMyAssignments = async (req, res) => {
  try {
    const studentId = req.user.id;
    const student   = await User.findByPk(studentId, { attributes: ['groupId'] });

    const effectiveGroupId = await resolveGroupId(studentId, student?.groupId);

    if (!effectiveGroupId) {
      return res.status(200).json({ assignments: [], message: 'No group assigned.' });
    }

    const assignments = await Assignment.findAll({
      where: { groupId: effectiveGroupId, isActive: true },
      include: [{
        model: Worksheet,
        as: 'worksheet',
        attributes: ['id', 'title', 'description']
      }],
      order: [sequelize.literal('due_date ASC NULLS LAST')]
    });

    const submissions = await Submission.findAll({
      where: { studentId },
      attributes: ['id', 'worksheetId', 'status', 'score', 'maxScore', 'submittedAt']
    });

    const subMap = {};
    submissions.forEach(s => { subMap[s.worksheetId] = s; });

    const result = assignments.map(a => ({
      ...a.toJSON(),
      submission:       subMap[a.worksheetId] || null,
      submissionStatus: subMap[a.worksheetId]?.status || 'pending'
    }));

    return res.status(200).json({ assignments: result });
  } catch (err) {
    console.error('getMyAssignments error:', err);
    return res.status(500).json({ message: 'Internal error', error: err.message });
  }
};

module.exports = { getStudentDashboard, getMyGroup, getMyAssignments };
