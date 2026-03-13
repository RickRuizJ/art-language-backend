'use strict';
const { User, Group, Assignment, Worksheet, Submission, GroupMember } = require('../models');

/**
 * GET /api/teachers/students
 * Lista plana de estudiantes del profesor (via group_members o teacher_id)
 */
const getMyStudents = async (req, res) => {
  try {
    const teacherId = req.user.id;

    // Obtener grupos del profesor
    const groups = await Group.findAll({
      where: { teacherId, isActive: true },
      attributes: ['id', 'name', 'subject', 'gradeLevel'],
      include: [
        {
          model: User,
          as: 'students',
          attributes: ['id', 'firstName', 'lastName', 'email', 'avatarUrl'],
          required: false
        }
      ],
      order: [['name', 'ASC']]
    });

    return res.status(200).json({ groups });
  } catch (err) {
    console.error('getMyStudents error:', err);
    return res.status(500).json({ message: 'Error interno', error: err.message });
  }
};

/**
 * GET /api/teachers/students/:studentId/profile
 * Perfil completo del estudiante con progreso
 */
const getStudentProfile = async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { studentId } = req.params;

    // Verificar que el estudiante está en un grupo del profesor
    const student = await User.findOne({
      where: { id: studentId, role: 'student' },
      attributes: ['id', 'firstName', 'lastName', 'email', 'avatarUrl', 'groupId', 'createdAt'],
      include: [
        {
          model: Group,
          as: 'group',
          where: { teacherId },   // solo si pertenece a este profesor
          attributes: ['id', 'name', 'subject']
        }
      ]
    });

    if (!student) {
      return res.status(404).json({ message: 'Estudiante no encontrado o no es tu alumno' });
    }

    // Assignments del grupo
    const assignments = await Assignment.findAll({
      where: { groupId: student.groupId, isActive: true },
      include: [
        { model: Worksheet, as: 'worksheet', attributes: ['id', 'title'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Submissions del estudiante
    const submissions = await Submission.findAll({
      where: { studentId },
      attributes: ['id', 'worksheetId', 'status', 'score', 'maxScore', 'submittedAt', 'gradedAt'],
      order: [['submittedAt', 'DESC']]
    });

    const subMap = {};
    submissions.forEach(s => { subMap[s.worksheetId] = s; });

    const assignmentsWithStatus = assignments.map(a => ({
      ...a.toJSON(),
      submission: subMap[a.worksheetId] || null,
      submissionStatus: subMap[a.worksheetId]?.status || 'pending'
    }));

    // Calcular progreso
    const completed = submissions.filter(s =>
      ['submitted', 'graded', 'reviewed'].includes(s.status)
    );
    const graded = submissions.filter(s => s.status === 'graded' && s.score !== null);

    let avgScore = null;
    if (graded.length > 0) {
      const sum = graded.reduce((acc, s) => {
        return acc + (s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0);
      }, 0);
      avgScore = Math.round(sum / graded.length);
    }

    return res.status(200).json({
      student: student.toJSON(),
      progress: {
        totalAssignments:     assignments.length,
        completedAssignments: completed.length,
        pendingAssignments:   assignments.length - completed.length,
        completionRate: assignments.length > 0
          ? Math.round((completed.length / assignments.length) * 100)
          : 0,
        avgScore
      },
      assignments: assignmentsWithStatus,
      recentSubmissions: submissions.slice(0, 5)
    });
  } catch (err) {
    console.error('getStudentProfile error:', err);
    return res.status(500).json({ message: 'Error interno', error: err.message });
  }
};

module.exports = { getMyStudents, getStudentProfile };
