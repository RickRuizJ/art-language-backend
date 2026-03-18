'use strict';
/**
 * controllers/studentController.js
 *
 * BUGS FIXED:
 * 1. `order: [['dueDate', 'ASC NULLS LAST']]`
 *    Sequelize's array order syntax does NOT support multi-word direction
 *    strings like 'ASC NULLS LAST'. Sequelize will pass the direction literally
 *    to the DB which some Postgres versions reject, and Sequelize may also
 *    sanitize/quote it incorrectly.
 *    FIX: Use `sequelize.literal('due_date ASC NULLS LAST')` for this ordering.
 *
 * 2. Same issue in getMyAssignments.
 */

const sequelize = require('../config/database');
const { User, Group, Assignment, Worksheet, Submission, GroupMember } = require('../models');

/**
 * GET /api/students/dashboard
 */
const getStudentDashboard = async (req, res) => {
  try {
    const studentId = req.user.id;

    // Student with their group
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
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    let assignments = [];
    let stats = { total: 0, completed: 0, pending: 0, avgScore: null };

    if (student.groupId) {
      // Assignments for the group
      const rawAssignments = await Assignment.findAll({
        where: { groupId: student.groupId, isActive: true },
        include: [{
          model: Worksheet,
          as: 'worksheet',
          attributes: ['id', 'title', 'description']
        }],
        // FIX: Use literal() for NULLS LAST ordering
        order: [sequelize.literal('due_date ASC NULLS LAST')]
      });

      // Student submissions
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

    return res.status(200).json({
      success: true,
      student: student.toJSON(),
      assignments,
      stats
    });
  } catch (err) {
    console.error('getStudentDashboard error:', err);
    return res.status(500).json({ success: false, message: 'Internal error', error: err.message });
  }
};

/**
 * GET /api/students/group
 */
const getMyGroup = async (req, res) => {
  try {
    const student = await User.findByPk(req.user.id, {
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

    if (!student?.group) {
      return res.status(200).json({ success: true, group: null, message: 'No group assigned.' });
    }

    return res.status(200).json({ success: true, group: student.group });
  } catch (err) {
    console.error('getMyGroup error:', err);
    return res.status(500).json({ success: false, message: 'Internal error', error: err.message });
  }
};

/**
 * GET /api/students/assignments
 */
const getMyAssignments = async (req, res) => {
  try {
    const studentId = req.user.id;
    const student   = await User.findByPk(studentId, { attributes: ['groupId'] });

    if (!student?.groupId) {
      return res.status(200).json({ success: true, assignments: [], message: 'No group assigned.' });
    }

    const assignments = await Assignment.findAll({
      where: { groupId: student.groupId, isActive: true },
      include: [{
        model: Worksheet,
        as: 'worksheet',
        attributes: ['id', 'title', 'description']
      }],
      // FIX: Use literal() for NULLS LAST
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

    return res.status(200).json({ success: true, assignments: result });
  } catch (err) {
    console.error('getMyAssignments error:', err);
    return res.status(500).json({ success: false, message: 'Internal error', error: err.message });
  }
};

module.exports = { getStudentDashboard, getMyGroup, getMyAssignments };
