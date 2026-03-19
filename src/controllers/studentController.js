'use strict';
/**
 * controllers/studentController.js
 *
 * ROOT CAUSE OF EMPTY ASSIGNMENTS:
 *
 * Two compounding bugs caused assignments to always return []:
 *
 * BUG A — resolveGroupId() only returned ONE groupId (findOne).
 *   If the teacher assigned worksheets to group X but findOne returned
 *   group Y, the WHERE groupId=Y found nothing.
 *
 * BUG B — resolveGroupId() ordered by 'joined_at'.
 *   The group_members table may not have a joined_at column (it is a custom
 *   field defined only in the Sequelize model — no SQL migration created it).
 *   ORDER BY "joined_at" throws SequelizeDatabaseError → the outer catch
 *   returns 500, but assignments was already initialized as [] so the client
 *   sees assignments:[].
 *
 * FIX:
 *   resolveAllGroupIds() — fetches ALL groups the student belongs to from
 *   BOTH users.group_id and every row in group_members (no ORDER BY).
 *   Assignment.findAll uses WHERE group_id IN (...) covering all groups.
 *   isActive uses Op.ne(false) to also match NULL rows.
 *   ORDER BY uses created_at (a real column) instead of due_date.
 */

const { Op }    = require('sequelize');
const { User, Group, Assignment, Worksheet, Submission, GroupMember } = require('../models');

/**
 * Returns every groupId the student belongs to.
 * Checks users.group_id AND all rows in group_members.
 * No ORDER BY — avoids crash if joined_at column doesn't exist in the DB.
 */
async function resolveAllGroupIds(studentId, directGroupId) {
  const ids = new Set();

  if (directGroupId) ids.add(directGroupId);

  try {
    const memberships = await GroupMember.findAll({
      where:      { studentId },
      attributes: ['groupId']
    });
    memberships.forEach(m => { if (m.groupId) ids.add(m.groupId); });
  } catch (err) {
    console.error('resolveAllGroupIds GroupMember error:', err.message);
  }

  return [...ids];
}

/**
 * GET /api/students/dashboard
 */
const getStudentDashboard = async (req, res) => {
  try {
    const studentId = req.user.id;

    // 1. Student with direct group association
    const student = await User.findByPk(studentId, {
      attributes: ['id', 'firstName', 'lastName', 'email', 'avatarUrl', 'groupId'],
      include: [{
        model:    Group,
        as:       'group',
        required: false,
        attributes: ['id', 'name', 'description', 'subject', 'gradeLevel'],
        include: [{
          model:      User,
          as:         'teacher',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl']
        }]
      }]
    });

    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }

    // 2. Collect every groupId this student belongs to
    const groupIds = await resolveAllGroupIds(studentId, student.groupId);

    let assignments = [];
    let stats       = { total: 0, completed: 0, pending: 0, avgScore: null };
    let groupData   = student.group || null;

    if (groupIds.length > 0) {
      // Load group info if not attached via users.group_id
      if (!groupData) {
        groupData = await Group.findByPk(groupIds[0], {
          attributes: ['id', 'name', 'description', 'subject', 'gradeLevel'],
          include: [{
            model:      User,
            as:         'teacher',
            attributes: ['id', 'firstName', 'lastName', 'avatarUrl']
          }]
        });
      }

      // 3. Assignments for all the student's groups
      const groupWhere = groupIds.length === 1
        ? groupIds[0]
        : { [Op.in]: groupIds };

      const rawAssignments = await Assignment.findAll({
        where: {
          groupId:  groupWhere,
          isActive: { [Op.ne]: false }   // catches TRUE and also NULL rows
        },
        include: [{
          model:      Worksheet,
          as:         'worksheet',
          attributes: ['id', 'title', 'description']
        }],
        order: [['created_at', 'DESC']]  // created_at always exists; avoids due_date issues
      });

      // 4. Student submissions
      const submissions = await Submission.findAll({
        where:      { studentId },
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
      const graded = submissions.filter(s =>
        s.status === 'graded' && s.score !== null
      );

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

    const studentJson = student.toJSON();
    if (!studentJson.group && groupData) {
      studentJson.group = typeof groupData.toJSON === 'function'
        ? groupData.toJSON()
        : groupData;
    }

    return res.status(200).json({
      student:     studentJson,
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
        model:    Group,
        as:       'group',
        required: false,
        attributes: ['id', 'name', 'description', 'subject', 'gradeLevel', 'joinCode'],
        include: [{
          model:      User,
          as:         'teacher',
          attributes: ['id', 'firstName', 'lastName', 'avatarUrl']
        }]
      }]
    });

    if (student?.group) {
      return res.status(200).json({ group: student.group });
    }

    const groupIds = await resolveAllGroupIds(studentId, student?.groupId);
    if (groupIds.length === 0) {
      return res.status(200).json({ group: null, message: 'No group assigned.' });
    }

    const group = await Group.findByPk(groupIds[0], {
      attributes: ['id', 'name', 'description', 'subject', 'gradeLevel', 'joinCode'],
      include: [{
        model:      User,
        as:         'teacher',
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
    const groupIds  = await resolveAllGroupIds(studentId, student?.groupId);

    if (groupIds.length === 0) {
      return res.status(200).json({ assignments: [], message: 'No group assigned.' });
    }

    const groupWhere = groupIds.length === 1
      ? groupIds[0]
      : { [Op.in]: groupIds };

    const assignments = await Assignment.findAll({
      where: {
        groupId:  groupWhere,
        isActive: { [Op.ne]: false }
      },
      include: [{
        model:      Worksheet,
        as:         'worksheet',
        attributes: ['id', 'title', 'description']
      }],
      order: [['created_at', 'DESC']]
    });

    const submissions = await Submission.findAll({
      where:      { studentId },
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
