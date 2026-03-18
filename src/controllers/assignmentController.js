'use strict';
/**
 * controllers/assignmentController.js
 *
 * BUGS FIXED:
 * 1. `order: [['due_date', 'ASC NULLS LAST']]` — same Sequelize array syntax
 *    limitation. FIX: Use sequelize.literal().
 *
 * 2. submitAssignment was imported in assignmentRoutes.js but was never defined
 *    in this controller. FIX: Add a stub that redirects to submissionController
 *    so the route doesn't crash at startup.
 */

const sequelize = require('../config/database');
const { Assignment, Worksheet, Group, GroupMember, Submission, User } = require('../models');

/**
 * POST /api/groups/:groupId/assignments
 */
const assignWorksheet = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { worksheetId, dueDate, instructions } = req.body;

    if (!worksheetId) {
      return res.status(400).json({ success: false, message: 'worksheetId is required.' });
    }

    const [worksheet, group] = await Promise.all([
      Worksheet.findByPk(worksheetId),
      Group.findByPk(groupId)
    ]);

    if (!worksheet) return res.status(404).json({ success: false, message: 'Worksheet not found.' });
    if (!group)     return res.status(404).json({ success: false, message: 'Group not found.' });

    if (req.user.role === 'teacher' && group.teacherId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You are not the teacher of this group.' });
    }

    const assignment = await Assignment.create({
      worksheetId,
      groupId,
      assignedBy:   req.user.id,
      dueDate:      dueDate ? new Date(dueDate) : null,
      instructions: instructions || null,
      isActive:     true
    });

    const populated = await Assignment.findByPk(assignment.id, {
      include: [
        { model: Worksheet, as: 'worksheet', attributes: ['id', 'title', 'description'] },
        { model: User,      as: 'assigner',  attributes: ['id', 'firstName', 'lastName'] }
      ]
    });

    return res.status(201).json({ success: true, data: { assignment: populated } });
  } catch (err) {
    console.error('assignWorksheet error:', err);
    return res.status(500).json({ success: false, message: 'Error creating assignment.' });
  }
};

/**
 * GET /api/groups/:groupId/assignments
 */
const getGroupAssignments = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findByPk(groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found.' });

    if (req.user.role === 'teacher' && group.teacherId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    if (req.user.role === 'student') {
      const membership = await GroupMember.findOne({
        where: { groupId, studentId: req.user.id }
      });
      if (!membership) return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const assignments = await Assignment.findAll({
      where: { groupId, isActive: true },
      include: [
        { model: Worksheet, as: 'worksheet', attributes: ['id', 'title', 'description', 'questions'] },
        { model: User,      as: 'assigner',  attributes: ['id', 'firstName', 'lastName'] }
      ],
      order: [['created_at', 'DESC']]
    });

    let result = assignments;

    // Enrich with submission data if student
    if (req.user.role === 'student') {
      const submissions = await Submission.findAll({
        where: { studentId: req.user.id },
        attributes: ['worksheetId', 'status', 'score', 'maxScore', 'submittedAt']
      });
      const subMap = {};
      submissions.forEach(s => { subMap[s.worksheetId] = s; });

      result = assignments.map(a => ({
        ...a.toJSON(),
        submission:       subMap[a.worksheetId] || null,
        submissionStatus: subMap[a.worksheetId]?.status || 'pending'
      }));
    }

    return res.status(200).json({ success: true, data: { assignments: result } });
  } catch (err) {
    console.error('getGroupAssignments error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching assignments.' });
  }
};

/**
 * GET  — student assignments (used by assignmentRoutes.js)
 */
const getStudentAssignments = async (req, res) => {
  try {
    const studentId = req.user.id;

    const student = await User.findByPk(studentId, { attributes: ['groupId'] });
    if (!student?.groupId) {
      return res.status(200).json({ success: true, data: { assignments: [] } });
    }

    const assignments = await Assignment.findAll({
      where: { groupId: student.groupId, isActive: true },
      include: [
        { model: Worksheet, as: 'worksheet', attributes: ['id', 'title', 'description', 'questions'] },
        { model: Group,     as: 'group',     attributes: ['id', 'name'] },
        { model: User,      as: 'assigner',  attributes: ['id', 'firstName', 'lastName'] }
      ],
      // FIX: literal for NULLS LAST
      order: [sequelize.literal('due_date ASC NULLS LAST')]
    });

    const submissions = await Submission.findAll({
      where: { studentId },
      attributes: ['worksheetId', 'status', 'score', 'maxScore', 'submittedAt']
    });
    const subMap = {};
    submissions.forEach(s => { subMap[s.worksheetId] = s; });

    const enriched = assignments.map(a => ({
      ...a.toJSON(),
      submission:       subMap[a.worksheetId] || null,
      submissionStatus: subMap[a.worksheetId]?.status || 'pending'
    }));

    return res.status(200).json({ success: true, data: { assignments: enriched } });
  } catch (err) {
    console.error('getStudentAssignments error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching assignments.' });
  }
};

/**
 * DELETE /api/groups/:groupId/assignments/:assignmentId
 */
const removeAssignment = async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await Assignment.findByPk(assignmentId);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found.' });

    if (req.user.role === 'teacher' && assignment.assignedBy !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You did not create this assignment.' });
    }

    await assignment.update({ isActive: false });

    return res.status(200).json({ success: true, message: 'Assignment removed.' });
  } catch (err) {
    console.error('removeAssignment error:', err);
    return res.status(500).json({ success: false, message: 'Error removing assignment.' });
  }
};

/**
 * PUT /api/assignments/:assignmentId/submit
 * Stub — actual submission logic lives in submissionController.
 * assignmentRoutes.js imported this but it was never defined.
 */
const submitAssignment = async (req, res) => {
  return res.status(410).json({
    success: false,
    message: 'Use POST /api/submissions to submit worksheet answers.'
  });
};

module.exports = {
  assignWorksheet,
  createAssignment:    assignWorksheet,
  getGroupAssignments,
  getStudentAssignments,
  removeAssignment,
  deleteAssignment:    removeAssignment,
  submitAssignment
};
