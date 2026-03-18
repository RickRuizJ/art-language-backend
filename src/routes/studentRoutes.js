'use strict';
/**
 * routes/studentRoutes.js
 *
 * BUGS FIXED:
 * Same as teacherRoutes.js: { authenticate } and { requireRole } were imported
 * as named exports that didn't exist → every /api/students/* request crashed.
 *
 * ALSO FIXED: This route was never mounted in app.js (original bug).
 * app.js now includes: app.use('/api/students', studentRoutes)
 *
 * NOTE: The bottom half of this file in the original was commented-out code
 * for teacherRoutes — that dead code has been removed.
 */

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/roleCheck');
const {
  getStudentDashboard,
  getMyGroup,
  getMyAssignments
} = require('../controllers/studentController');

router.use(authenticate);
router.use(requireRole('student'));

// GET /api/students/dashboard
router.get('/dashboard', getStudentDashboard);

// GET /api/students/group
router.get('/group', getMyGroup);

// GET /api/students/assignments
router.get('/assignments', getMyAssignments);

module.exports = router;
