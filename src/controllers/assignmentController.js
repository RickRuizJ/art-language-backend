const Assignment = require('../models/Assignment');
const Worksheet = require('../models/Worksheet');
const Group = require('../models/Group');

/**
 * GET /students/:studentId/assignments
 * Returns all assignments visible to a student across all their groups.
 */
const getStudentAssignments = async (req, res) => {
  try {
    const { studentId } = req.params;

    // Students can only view their own assignments
    if (req.user.role === 'student' && req.user.id !== studentId) {
      return res.status(403).json({ status: 'error', message: 'Access denied.' });
    }

    // Find all groups the student belongs to
    const groups = await Group.find({ 'members.studentId': studentId }).lean();
    const groupIds = groups.map(g => g._id);

    if (groupIds.length === 0) {
      return res.status(200).json({ status: 'success', data: { assignments: [] } });
    }

    // Find all assignments for those groups, populate worksheet
    const assignments = await Assignment.find({ groupId: { $in: groupIds } })
      .populate('worksheetId', 'title description subject gradeLevel estimatedTime questions')
      .populate('groupId', 'name')
      .populate('assignedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    // Attach this student's submission status to each assignment
    const enriched = assignments.map(a => {
      const submission = (a.submissions || []).find(
        s => s.studentId?.toString() === studentId
      );
      return {
        id: a._id,
        worksheet: a.worksheetId
          ? { ...a.worksheetId, id: a.worksheetId._id }
          : null,
        group: a.groupId
          ? { ...a.groupId, id: a.groupId._id }
          : null,
        assignedBy: a.assignedBy,
        dueDate: a.dueDate,
        instructions: a.instructions,
        createdAt: a.createdAt,
        status: submission ? submission.status : 'not_started',
        score: submission?.score ?? null,
        submittedAt: submission?.submittedAt ?? null,
      };
    });

    res.status(200).json({ status: 'success', data: { assignments: enriched } });
  } catch (err) {
    console.error('getStudentAssignments error:', err);
    res.status(500).json({ status: 'error', message: 'Server error retrieving assignments.' });
  }
};

/**
 * GET /groups/:groupId/assignments
 * Returns all assignments for a group (already existing in many backends — this
 * is the authoritative version that populates worksheets correctly).
 */
const getGroupAssignments = async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findById(groupId).lean();
    if (!group) {
      return res.status(404).json({ status: 'error', message: 'Group not found.' });
    }

    // Teachers must own the group; students must be members
    if (req.user.role === 'teacher' && group.teacherId?.toString() !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'Access denied.' });
    }
    if (req.user.role === 'student') {
      const isMember = (group.members || []).some(m => m.studentId?.toString() === req.user.id);
      if (!isMember) {
        return res.status(403).json({ status: 'error', message: 'Access denied.' });
      }
    }

    const assignments = await Assignment.find({ groupId })
      .populate('worksheetId', 'title description subject gradeLevel estimatedTime questions')
      .populate('assignedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();

    const formatted = assignments.map(a => ({
      id: a._id,
      worksheet: a.worksheetId ? { ...a.worksheetId, id: a.worksheetId._id } : null,
      assignedBy: a.assignedBy,
      dueDate: a.dueDate,
      instructions: a.instructions,
      submissions: a.submissions || [],
      createdAt: a.createdAt,
    }));

    res.status(200).json({ status: 'success', data: { assignments: formatted } });
  } catch (err) {
    console.error('getGroupAssignments error:', err);
    res.status(500).json({ status: 'error', message: 'Server error.' });
  }
};

/**
 * POST /groups/:groupId/assignments
 * Teacher assigns a worksheet to a group.
 * Body: { worksheetId, dueDate?, instructions? }
 */
const createAssignment = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ status: 'error', message: 'Only teachers can create assignments.' });
    }

    const { groupId } = req.params;
    const { worksheetId, dueDate, instructions } = req.body;

    if (!worksheetId) {
      return res.status(400).json({ status: 'error', message: 'worksheetId is required.' });
    }

    const [worksheet, group] = await Promise.all([
      Worksheet.findById(worksheetId),
      Group.findById(groupId),
    ]);

    if (!worksheet) return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });
    if (!group) return res.status(404).json({ status: 'error', message: 'Group not found.' });

    if (group.teacherId?.toString() !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'You do not own this group.' });
    }

    const assignment = new Assignment({
      worksheetId,
      groupId,
      assignedBy: req.user.id,
      dueDate: dueDate ? new Date(dueDate) : null,
      instructions: instructions || null,
      submissions: [],
    });

    await assignment.save();

    const populated = await Assignment.findById(assignment._id)
      .populate('worksheetId', 'title description')
      .populate('assignedBy', 'firstName lastName')
      .lean();

    res.status(201).json({
      status: 'success',
      data: {
        assignment: {
          ...populated,
          id: populated._id,
          worksheet: populated.worksheetId ? { ...populated.worksheetId, id: populated.worksheetId._id } : null,
        },
      },
    });
  } catch (err) {
    console.error('createAssignment error:', err);
    res.status(500).json({ status: 'error', message: 'Server error creating assignment.' });
  }
};

/**
 * PUT /assignments/:assignmentId/submit
 * Student submits answers for an assignment.
 * Body: { answers: [...] }
 */
const submitAssignment = async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(403).json({ status: 'error', message: 'Only students can submit assignments.' });
    }

    const { answers } = req.body;
    const assignment = await Assignment.findById(req.params.assignmentId)
      .populate('worksheetId')
      .populate('groupId', 'members');

    if (!assignment) return res.status(404).json({ status: 'error', message: 'Assignment not found.' });

    // Verify student is a group member
    const isMember = (assignment.groupId?.members || []).some(
      m => m.studentId?.toString() === req.user.id
    );
    if (!isMember) return res.status(403).json({ status: 'error', message: 'Access denied.' });

    // Check for existing submission
    const existingIdx = assignment.submissions.findIndex(
      s => s.studentId?.toString() === req.user.id
    );
    if (existingIdx !== -1 && assignment.submissions[existingIdx].status === 'submitted') {
      return res.status(400).json({ status: 'error', message: 'Already submitted.' });
    }

    // Auto-grade objective questions
    const questions = assignment.worksheetId?.questions || [];
    let earned = 0;
    let total = 0;

    questions.forEach((q, i) => {
      const pts = q.points || 10;
      total += pts;
      const studentAnswer = answers?.[i];

      if (q.type === 'multiple_choice' || q.type === 'true_false') {
        if (studentAnswer !== undefined && studentAnswer === q.correctAnswer) {
          earned += pts;
        }
      } else if (q.type === 'fill_blank') {
        if (
          typeof studentAnswer === 'string' &&
          studentAnswer.trim().toLowerCase() === (q.correctAnswer || '').toLowerCase()
        ) {
          earned += pts;
        }
      }
      // 'matching' and 'short_answer' require manual grading — score stays null
    });

    const score = total > 0 ? Math.round((earned / total) * 100) : null;
    const submissionData = {
      studentId: req.user.id,
      status: 'submitted',
      answers: answers || [],
      score,
      submittedAt: new Date(),
    };

    if (existingIdx !== -1) {
      assignment.submissions[existingIdx] = { ...assignment.submissions[existingIdx], ...submissionData };
    } else {
      assignment.submissions.push(submissionData);
    }

    await assignment.save();
    res.status(200).json({ status: 'success', data: { score, message: 'Assignment submitted successfully.' } });
  } catch (err) {
    console.error('submitAssignment error:', err);
    res.status(500).json({ status: 'error', message: 'Server error submitting assignment.' });
  }
};

/**
 * DELETE /groups/:groupId/assignments/:assignmentId
 * Teacher removes an assignment from a group.
 */
const deleteAssignment = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ status: 'error', message: 'Only teachers can remove assignments.' });
    }

    const assignment = await Assignment.findById(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ status: 'error', message: 'Assignment not found.' });

    if (assignment.assignedBy?.toString() !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'You did not create this assignment.' });
    }

    await assignment.deleteOne();
    res.status(200).json({ status: 'success', data: null });
  } catch (err) {
    console.error('deleteAssignment error:', err);
    res.status(500).json({ status: 'error', message: 'Server error.' });
  }
};

module.exports = {
  getStudentAssignments,
  getGroupAssignments,
  createAssignment,
  submitAssignment,
  deleteAssignment,
};
