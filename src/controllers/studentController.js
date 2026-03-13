'use strict';
const { User, Group, Assignment, Worksheet, Submission, GroupMember } = require('../models');
const { Op } = require('sequelize');

/**
 * GET /api/students/dashboard
 * Retorna: grupo + assignments del grupo + stats del estudiante
 */
const getStudentDashboard = async (req, res) => {
  try {
    const studentId = req.user.id;

    // 1. Obtener estudiante con su grupo
    const student = await User.findByPk(studentId, {
      attributes: ['id', 'firstName', 'lastName', 'email', 'avatarUrl', 'groupId'],
      include: [
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'description', 'subject', 'gradeLevel'],
          include: [
            {
              model: User,
              as: 'teacher',
              attributes: ['id', 'firstName', 'lastName', 'avatarUrl']
            }
          ]
        }
      ]
    });

    if (!student) {
      return res.status(404).json({ message: 'Estudiante no encontrado' });
    }

    let assignments = [];
    let stats = { total: 0, completed: 0, pending: 0, avgScore: null };

    if (student.groupId) {
      // 2. Assignments del grupo
      const rawAssignments = await Assignment.findAll({
        where: { groupId: student.groupId, isActive: true },
        include: [
          {
            model: Worksheet,
            as: 'worksheet',
            attributes: ['id', 'title', 'description']
          }
        ],
        order: [['dueDate', 'ASC NULLS LAST']]
      });

      // 3. Submissions del estudiante
      const submissions = await Submission.findAll({
        where: { studentId },
        attributes: ['id', 'worksheetId', 'status', 'score', 'maxScore', 'submittedAt']
      });

      // Mapa rápido worksheetId → submission
      const subMap = {};
      submissions.forEach(s => { subMap[s.worksheetId] = s; });

      assignments = rawAssignments.map(a => {
        const sub = subMap[a.worksheetId] || null;
        return {
          ...a.toJSON(),
          submission: sub,
          submissionStatus: sub ? sub.status : 'pending'
        };
      });

      // 4. Stats
      const completed = submissions.filter(s => ['submitted', 'graded', 'reviewed'].includes(s.status));
      const graded    = submissions.filter(s => s.status === 'graded' && s.score !== null);

      stats.total     = assignments.length;
      stats.completed = completed.length;
      stats.pending   = stats.total - stats.completed;

      if (graded.length > 0) {
        const sum = graded.reduce((acc, s) => {
          return acc + (s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0);
        }, 0);
        stats.avgScore = Math.round(sum / graded.length);
      }
    }

    return res.status(200).json({
      student: student.toJSON(),
      assignments,
      stats
    });
  } catch (err) {
    console.error('getStudentDashboard error:', err);
    return res.status(500).json({ message: 'Error interno', error: err.message });
  }
};

/**
 * GET /api/students/group
 * Retorna el grupo del estudiante con su profesor
 */
const getMyGroup = async (req, res) => {
  try {
    const student = await User.findByPk(req.user.id, {
      attributes: ['id', 'firstName', 'groupId'],
      include: [
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'description', 'subject', 'gradeLevel', 'joinCode'],
          include: [
            {
              model: User,
              as: 'teacher',
              attributes: ['id', 'firstName', 'lastName', 'avatarUrl']
            }
          ]
        }
      ]
    });

    if (!student?.group) {
      return res.status(200).json({ group: null, message: 'Sin grupo asignado' });
    }

    return res.status(200).json({ group: student.group });
  } catch (err) {
    console.error('getMyGroup error:', err);
    return res.status(500).json({ message: 'Error interno', error: err.message });
  }
};

/**
 * GET /api/students/assignments
 * Lista de assignments del grupo del estudiante
 */
const getMyAssignments = async (req, res) => {
  try {
    const studentId = req.user.id;
    const student = await User.findByPk(studentId, { attributes: ['groupId'] });

    if (!student?.groupId) {
      return res.status(200).json({ assignments: [], message: 'Sin grupo asignado' });
    }

    const assignments = await Assignment.findAll({
      where: { groupId: student.groupId, isActive: true },
      include: [
        { model: Worksheet, as: 'worksheet', attributes: ['id', 'title', 'description'] }
      ],
      order: [['dueDate', 'ASC NULLS LAST']]
    });

    const submissions = await Submission.findAll({
      where: { studentId },
      attributes: ['id', 'worksheetId', 'status', 'score', 'maxScore', 'submittedAt']
    });

    const subMap = {};
    submissions.forEach(s => { subMap[s.worksheetId] = s; });

    const result = assignments.map(a => ({
      ...a.toJSON(),
      submission: subMap[a.worksheetId] || null,
      submissionStatus: subMap[a.worksheetId]?.status || 'pending'
    }));

    return res.status(200).json({ assignments: result });
  } catch (err) {
    console.error('getMyAssignments error:', err);
    return res.status(500).json({ message: 'Error interno', error: err.message });
  }
};

module.exports = { getStudentDashboard, getMyGroup, getMyAssignments };
