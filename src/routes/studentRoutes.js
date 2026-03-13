'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// src/routes/studentRoutes.js
// ─────────────────────────────────────────────────────────────────────────────
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

router.get('/dashboard',    getStudentDashboard);  // GET /api/students/dashboard
router.get('/group',        getMyGroup);            // GET /api/students/group
router.get('/assignments',  getMyAssignments);      // GET /api/students/assignments

module.exports = router;


// ─────────────────────────────────────────────────────────────────────────────
// src/routes/teacherRoutes.js  (archivo separado — ver abajo)
// ─────────────────────────────────────────────────────────────────────────────
// const router2 = require('express').Router();
// const { authenticate } = require('../middleware/auth');
// const { requireRole }  = require('../middleware/roleCheck');
// const { getMyStudents, getStudentProfile } = require('../controllers/teacherController');
//
// router2.use(authenticate);
// router2.use(requireRole('teacher', 'admin'));
//
// router2.get('/students',                    getMyStudents);       // GET /api/teachers/students
// router2.get('/students/:studentId/profile', getStudentProfile);   // GET /api/teachers/students/:id/profile
//
// module.exports = router2;
