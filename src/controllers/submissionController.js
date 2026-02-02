const { Submission, Worksheet, User } = require('../models');

// Auto-grade function
const autoGrade = (worksheet, answers) => {
  let score = 0;
  let maxScore = 0;
  const gradedAnswers = [];

  worksheet.questions.forEach((question) => {
    maxScore += question.points || 10;
    const studentAnswer = answers.find(a => a.questionId === question.id);
    
    if (!studentAnswer) {
      gradedAnswers.push({
        questionId: question.id,
        answer: null,
        isCorrect: false,
        pointsEarned: 0
      });
      return;
    }

    let isCorrect = false;
    let pointsEarned = 0;

    switch (question.type) {
      case 'multiple_choice':
      case 'true_false':
        isCorrect = studentAnswer.answer === question.correctAnswer;
        pointsEarned = isCorrect ? (question.points || 10) : 0;
        break;

      case 'fill_blank':
        const correctAnswers = Array.isArray(question.correctAnswer) 
          ? question.correctAnswer 
          : [question.correctAnswer];
        isCorrect = correctAnswers.some(correct => 
          studentAnswer.answer?.toLowerCase().trim() === correct.toLowerCase().trim()
        );
        pointsEarned = isCorrect ? (question.points || 10) : 0;
        break;

      case 'matching':
        // Expect studentAnswer.answer to be object: { "a": "1", "b": "2" }
        const correctMatches = question.correctAnswer || {};
        const studentMatches = studentAnswer.answer || {};
        const totalMatches = Object.keys(correctMatches).length;
        let correctCount = 0;
        
        Object.keys(correctMatches).forEach(key => {
          if (studentMatches[key] === correctMatches[key]) {
            correctCount++;
          }
        });
        
        isCorrect = correctCount === totalMatches;
        pointsEarned = (correctCount / totalMatches) * (question.points || 10);
        break;

      case 'short_answer':
      case 'essay':
        // Manual grading required
        isCorrect = null;
        pointsEarned = null;
        break;
    }

    score += pointsEarned || 0;
    
    gradedAnswers.push({
      questionId: question.id,
      answer: studentAnswer.answer,
      isCorrect,
      pointsEarned
    });
  });

  return {
    answers: gradedAnswers,
    score: Math.round(score * 100) / 100,
    maxScore,
    percentage: Math.round((score / maxScore) * 100)
  };
};

// @route   POST /api/submissions
// @desc    Submit worksheet answers
// @access  Private (Student)
exports.submitWorksheet = async (req, res) => {
  try {
    const { worksheetId, answers } = req.body;

    // Find worksheet
    const worksheet = await Worksheet.findByPk(worksheetId);
    if (!worksheet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Worksheet not found' 
      });
    }

    // Check if already submitted
    const existing = await Submission.findOne({
      where: {
        worksheetId,
        studentId: req.user.id
      }
    });

    if (existing) {
      return res.status(400).json({ 
        success: false, 
        message: 'Worksheet already submitted' 
      });
    }

    // Auto-grade if enabled
    let gradingResult;
    let status = 'pending';

    if (worksheet.autoGrade) {
      gradingResult = autoGrade(worksheet, answers);
      status = 'graded';
    }

    // Create submission
    const submission = await Submission.create({
      worksheetId,
      studentId: req.user.id,
      answers: gradingResult?.answers || answers,
      score: gradingResult?.score || null,
      maxScore: gradingResult?.maxScore || null,
      status
    });

    res.status(201).json({
      success: true,
      message: 'Worksheet submitted successfully',
      data: { 
        submission,
        ...(gradingResult && { 
          score: gradingResult.score,
          maxScore: gradingResult.maxScore,
          percentage: gradingResult.percentage
        })
      }
    });
  } catch (error) {
    console.error('Submit worksheet error:', error);
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
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
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
    console.error('Get student submissions error:', error);
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
    console.error('Get worksheet submissions error:', error);
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
    console.error('Grade submission error:', error);
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

    res.json({
      success: true,
      data: { submission }
    });
  } catch (error) {
    console.error('Get submission error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};
