const express = require('express');
const router = express.Router();
const { getStudentProgress } = require('../controllers/studentController');
const { protect } = require('../middleware/auth');

router.use(protect);

// GET /api/students/:studentId/progress
router.get('/:studentId/progress', getStudentProgress);

module.exports = router;
