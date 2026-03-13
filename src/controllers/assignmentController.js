'use strict';
const { Assignment, Worksheet, Group, GroupMember, Submission, User } = require('../models');

/**
 * POST /api/groups/:groupId/assignments
 * Profesor asigna un worksheet a un grupo
 */
const assignWorksheet = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { worksheetId, dueDate, instructions } = req.body;

    if (!worksheetId) {
      return res.status(400).json({ status: 'error', message: 'worksheetId es requerido.' });
    }

    const [worksheet, group] = await Promise.all([
      Worksheet.findByPk(worksheetId),
      Group.findByPk(groupId),
    ]);

    if (!worksheet) return res.status(404).json({ status: 'error', message: 'Worksheet no encontrado.' });
    if (!group)     return res.status(404).json({ status: 'error', message: 'Grupo no encontrado.' });

    if (req.user.role === 'teacher' && group.teacherId !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'No eres el profesor de este grupo.' });
    }

    const assignment = await Assignment.create({
      worksheetId,
      groupId,
      assignedBy: req.user.id,
      dueDate: dueDate ? new Date(dueDate) : null,
      instructions: instructions || null,
      isActive: true,
    });

    const populated = await Assignment.findByPk(assignment.id, {
      include: [
        { model: Worksheet, as: 'worksheet', attributes: ['id', 'title', 'description'] },
        { model: User, as: 'assigner', attributes: ['id', 'firstName', 'lastName'] },
      ]
    });

    return res.status(201).json({ status: 'success', data: { assignment: populated } });
  } catch (err) {
    console.error('assignWorksheet error:', err);
    return res.status(500).json({ status: 'error', message: 'Error creando assignment.' });
  }
};

/**
 * GET /api/groups/:groupId/assignments
 * Obtener assignments de un grupo
 */
const getGroupAssignments = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findByPk(groupId);
    if (!group) return res.status(404).json({ status: 'error', message: 'Grupo no encontrado.' });

    if (req.user.role === 'teacher' && group.teacherId !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'Acceso denegado.' });
    }

    if (req.user.role === 'student') {
      const membership = await GroupMember.findOne({
        where: { groupId, studentId: req.user.id }
      });
      if (!membership) return res.status(403).json({ status: 'error', message: 'Acceso denegado.' });
    }

    const assignments = await Assignment.findAll({
      where: { groupId, isActive: true },
      include: [
        { model: Worksheet, as: 'worksheet', attributes: ['id', 'title', 'description', 'questions'] },
        { model: User, as: 'assigner', attributes: ['id', 'firstName', 'lastName'] },
      ],
      order: [['created_at', 'DESC']]
    });

    // Si es estudiante, adjuntar su submission a cada assignment
    let result = assignments;
    if (req.user.role === 'student') {
      const submissions = await Submission.findAll({
        where: { studentId: req.user.id },
        attributes: ['worksheetId', 'status', 'score', 'maxScore', 'submittedAt']
      });
      const subMap = {};
      submissions.forEach(s => { subMap[s.worksheetId] = s; });

      result = assignments.map(a => ({
        ...a.toJSON(),
        submission: subMap[a.worksheetId] || null,
        submissionStatus: subMap[a.worksheetId]?.status || 'pending'
      }));
    }

    return res.status(200).json({ status: 'success', data: { assignments: result } });
  } catch (err) {
    console.error('getGroupAssignments error:', err);
    return res.status(500).json({ status: 'error', message: 'Error obteniendo assignments.' });
  }
};

/**
 * GET /api/students/assignments
 * Assignments del estudiante autenticado según su groupId
 */
const getStudentAssignments = async (req, res) => {
  try {
    const studentId = req.user.id;

    const student = await User.findByPk(studentId, { attributes: ['groupId'] });
    if (!student?.groupId) {
      return res.status(200).json({ status: 'success', data: { assignments: [] } });
    }

    const assignments = await Assignment.findAll({
      where: { groupId: student.groupId, isActive: true },
      include: [
        { model: Worksheet, as: 'worksheet', attributes: ['id', 'title', 'description', 'questions'] },
        { model: Group, as: 'group', attributes: ['id', 'name'] },
        { model: User, as: 'assigner', attributes: ['id', 'firstName', 'lastName'] },
      ],
      order: [['due_date', 'ASC NULLS LAST']]
    });

    const submissions = await Submission.findAll({
      where: { studentId },
      attributes: ['worksheetId', 'status', 'score', 'maxScore', 'submittedAt']
    });
    const subMap = {};
    submissions.forEach(s => { subMap[s.worksheetId] = s; });

    const enriched = assignments.map(a => ({
      ...a.toJSON(),
      submission: subMap[a.worksheetId] || null,
      submissionStatus: subMap[a.worksheetId]?.status || 'pending'
    }));

    return res.status(200).json({ status: 'success', data: { assignments: enriched } });
  } catch (err) {
    console.error('getStudentAssignments error:', err);
    return res.status(500).json({ status: 'error', message: 'Error obteniendo assignments.' });
  }
};

/**
 * DELETE /api/groups/:groupId/assignments/:assignmentId
 * Profesor elimina un assignment
 */
const removeAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await Assignment.findByPk(assignmentId);
    if (!assignment) return res.status(404).json({ status: 'error', message: 'Assignment no encontrado.' });

    if (req.user.role === 'teacher' && assignment.assignedBy !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'No creaste este assignment.' });
    }

    await assignment.update({ isActive: false });

    return res.status(200).json({ status: 'success', message: 'Assignment eliminado.' });
  } catch (err) {
    console.error('removeAssignment error:', err);
    return res.status(500).json({ status: 'error', message: 'Error eliminando assignment.' });
  }
};

module.exports = {
  assignWorksheet,       // alias usado en groups.js
  createAssignment: assignWorksheet,  // alias alternativo
  getGroupAssignments,
  getStudentAssignments,
  removeAssignment,
  deleteAssignment: removeAssignment, // alias alternativo
};
