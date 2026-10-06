const { Op } = require('sequelize');
const { Submission, Worksheet, User, Assignment, Group, GroupMember } = require('../models');
const gradingService = require('../services/grading.service');
const logger = require('../config/logger');

/**
 * SPRINT 0 FIX — unified grading engine
 * The local `autoGrade()` function that used to live here has been removed.
 * Grading now always goes through services/grading.service.js — the single
 * autograde engine used by the whole LMS (see that file's header comment).
 *
 * Adapter: the client submits `answers` as an array of
 * { questionId, answer }, but gradingService.gradeSubmission expects a plain
 * { [questionId]: answer } map. This function only reshapes data — no
 * grading logic lives here anymore.
 */
function answersArrayToMap(answers) {
  const map = {};
  (answers || []).forEach(a => { map[a.questionId] = a.answer; });
  return map;
}

// SPRINT 0 FIX — multiple configurable attempts.
// `Worksheet.maxAttempts` (added in this sprint's migration; null/0 = unlimited)
// replaces the previous hard block on any second submission.

// @route   POST /api/submissions
// @desc    Submit worksheet answers
// @access  Private (Student)
exports.submitWorksheet = async (req, res) => {
  try {
    const { worksheetId, answers, timeSpentSeconds } = req.body;

    // Find worksheet
    const worksheet = await Worksheet.findByPk(worksheetId);
    if (!worksheet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Worksheet not found' 
      });
    }

    // A student may submit only a worksheet assigned to one of their groups.
    const [memberships, studentRecord] = await Promise.all([
      GroupMember.findAll({ where: { studentId: req.user.id }, attributes: ['groupId'] }),
      User.findByPk(req.user.id, { attributes: ['groupId'] })
    ]);
    const groupIds = [...new Set([...memberships.map(m => m.groupId), studentRecord?.groupId].filter(Boolean))];
    const assignment = groupIds.length ? await Assignment.findOne({
      where: { worksheetId, groupId: { [Op.in]: groupIds }, isActive: { [Op.ne]: false } },
      attributes: ['id']
    }) : null;
    if (!assignment) return res.status(403).json({ success: false, message: 'This worksheet is not assigned to you.' });

    if (answers !== undefined && !Array.isArray(answers)) {
      return res.status(400).json({ success: false, message: 'answers must be an array.' });
    }

    // How many attempts has this student already made on this worksheet?
    const previousAttempts = await Submission.count({
      where: { worksheetId, studentId: req.user.id }
    });

    const maxAttempts = worksheet.maxAttempts; // null/0 = unlimited
    if (maxAttempts && previousAttempts >= maxAttempts) {
      return res.status(400).json({
        success: false,
        message: `Maximum attempts reached (${maxAttempts}).`
      });
    }

    // Auto-grade if enabled — always via the unified gradingService.
    let gradingResult;
    let status = worksheet.autoGrade ? 'pending' : 'submitted';

    if (worksheet.autoGrade) {
      const answersMap = answersArrayToMap(answers);
      gradingResult = await gradingService.gradeSubmission(worksheet, answersMap);
      // Si alguna pregunta necesita revisión manual, la entrega queda en manos del profesor.
      status = gradingResult.feedback.some(f => f.requiresManualReview) ? 'submitted' : 'graded';
    }

    // Reshape gradingService's feedback[] back into the answers[] format the
    // rest of the app already expects (isCorrect/pointsEarned per question).
    const gradedAnswers = gradingResult
      ? gradingResult.feedback.map(f => ({
          questionId: f.questionId,
          answer: answersArrayToMap(answers)[f.questionId] ?? null,
          isCorrect: f.correct,
          pointsEarned: f.pointsEarned,
          requiresManualReview: f.requiresManualReview
        }))
      : answers;

    // Create submission
    const submission = await Submission.create({
      worksheetId,
      studentId: req.user.id,
      answers: gradedAnswers,
      score: gradingResult?.score ?? null,
      maxScore: gradingResult?.maxScore ?? null,
      status,
      attemptNumber: previousAttempts + 1,
      timeSpentSeconds: timeSpentSeconds ?? null
    });

    res.status(201).json({
      success: true,
      message: 'Worksheet submitted successfully',
      data: { 
        submission,
        attemptNumber: submission.attemptNumber,
        attemptsRemaining: maxAttempts ? Math.max(0, maxAttempts - submission.attemptNumber) : null,
        ...(gradingResult && { 
          score: gradingResult.score,
          maxScore: gradingResult.maxScore,
          percentage: gradingResult.percentage
        })
      }
    });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'Esta entrega ya se había enviado. Actualiza la página.' });
    }
    logger.error('Submit worksheet error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};

// @route   GET /api/submissions/student/:studentId
// @desc    Get student's submissions
// @access  Private
exports.getStudentSubmissions = async (req, res) => {
  try {
    const studentId = req.params.studentId;

    // Check permissions
    if (req.user.role === 'student' && req.user.id !== studentId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (req.user.role === 'teacher') {
      const membership = await GroupMember.findOne({
        where: { studentId },
        include: [{ model: Group, as: 'group', where: { teacherId: req.user.id }, attributes: ['id'] }]
      });
      const direct = await User.findOne({ where: { id: studentId, teacherId: req.user.id }, attributes: ['id'] });
      if (!membership && !direct) return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const submissions = await Submission.findAll({
      where: { studentId },
      include: [{
        model: Worksheet,
        as: 'worksheet',
        attributes: ['id', 'title', 'subject', 'gradeLevel']
      }],
      order: [['submittedAt', 'DESC']]
    });

    res.json({
      success: true,
      data: { submissions }
    });
  } catch (error) {
    logger.error('Get student submissions error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};

// @route   GET /api/submissions/worksheet/:worksheetId
// @desc    Get all submissions for a worksheet
// @access  Private (Teacher, Admin)
exports.getWorksheetSubmissions = async (req, res) => {
  try {
    const worksheet = await Worksheet.findByPk(req.params.worksheetId);

    if (!worksheet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Worksheet not found' 
      });
    }

    // Check permissions
    if (req.user.role === 'teacher' && worksheet.createdBy !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    const submissions = await Submission.findAll({
      where: { worksheetId: req.params.worksheetId },
      include: [{
        model: User,
        as: 'student',
        attributes: ['id', 'firstName', 'lastName', 'email']
      }],
      order: [['submittedAt', 'DESC']]
    });

    res.json({
      success: true,
      data: { submissions }
    });
  } catch (error) {
    logger.error('Get worksheet submissions error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};

// @route   PUT /api/submissions/:id/grade
// @desc    Manually grade submission
// @access  Private (Teacher, Admin)
exports.gradeSubmission = async (req, res) => {
  try {
    const { score, feedback } = req.body;
    
    const submission = await Submission.findByPk(req.params.id, {
      include: [{
        model: Worksheet,
        as: 'worksheet'
      }]
    });

    if (!submission) {
      return res.status(404).json({ 
        success: false, 
        message: 'Submission not found' 
      });
    }

    // Check permissions
    if (req.user.role === 'teacher' && 
        submission.worksheet.createdBy !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    await submission.update({
      score,
      feedback,
      status: 'reviewed',
      gradedBy: req.user.id,
      gradedAt: new Date()
    });

    res.json({
      success: true,
      message: 'Submission graded successfully',
      data: { submission }
    });
  } catch (error) {
    logger.error('Grade submission error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};

// @route   GET /api/submissions/:id
// @desc    Get single submission
// @access  Private
exports.getSubmission = async (req, res) => {
  try {
    const submission = await Submission.findByPk(req.params.id, {
      include: [
        {
          model: Worksheet,
          as: 'worksheet'
        },
        {
          model: User,
          as: 'student',
          attributes: ['id', 'firstName', 'lastName', 'email']
        }
      ]
    });

    if (!submission) {
      return res.status(404).json({ 
        success: false, 
        message: 'Submission not found' 
      });
    }

    // Check permissions
    if (req.user.role === 'student' && submission.studentId !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    if (req.user.role === 'teacher' && 
        submission.worksheet.createdBy !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    const responseSubmission = submission.toJSON();
    if (req.user.role === 'student' && responseSubmission.worksheet) {
      delete responseSubmission.worksheet.questions;
    }

    res.json({
      success: true,
      data: { submission: responseSubmission }
    });
  } catch (error) {
    logger.error('Get submission error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};
