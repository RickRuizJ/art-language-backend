const express = require('express');
const router = express.Router();
const submissionController = require('../controllers/submissionController');
const auth = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');

// All routes require authentication
router.use(auth);

// Submit worksheet (Student only)
router.post('/', roleCheck('student'), submissionController.submitWorksheet);

// Get single submission
router.get('/:id', submissionController.getSubmission);

// Get student's submissions
router.get('/student/:studentId', submissionController.getStudentSubmissions);

// Get all submissions for a worksheet (Teacher, Admin)
router.get('/worksheet/:worksheetId', 
  roleCheck('teacher', 'admin'), 
  submissionController.getWorksheetSubmissions
);

// Grade submission (Teacher, Admin)
router.put('/:id/grade', 
  roleCheck('teacher', 'admin'), 
  submissionController.gradeSubmission
);

module.exports = router;
