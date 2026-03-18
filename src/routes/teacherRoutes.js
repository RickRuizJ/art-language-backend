'use strict';
/**
 * routes/teacherRoutes.js
 *
 * BUGS FIXED:
 * The original file imported `{ authenticate }` and `{ requireRole }` as named
 * exports from auth.js and roleCheck.js. Those named exports did not exist —
 * only the default function was exported. Every request to /api/teachers/*
 * crashed with "authenticate is not a function" before reaching the controller.
 *
 * The middleware files now export these named aliases. This route file is
 * correct as-is once the middleware is fixed — kept here for clarity.
 *
 * ALSO FIXED: This route was never mounted in app.js (original bug).
 * app.js now includes: app.use('/api/teachers', teacherRoutes)
 */

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/roleCheck');
const { getMyStudents, getStudentProfile } = require('../controllers/teacherController');

router.use(authenticate);
router.use(requireRole('teacher', 'admin'));

// GET /api/teachers/students
router.get('/students', getMyStudents);

// GET /api/teachers/students/:studentId/profile
router.get('/students/:studentId/profile', getStudentProfile);

module.exports = router;
