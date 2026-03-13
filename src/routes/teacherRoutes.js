'use strict';
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/roleCheck');
const { getMyStudents, getStudentProfile } = require('../controllers/teacherController');

router.use(authenticate);
router.use(requireRole('teacher', 'admin'));

// GET /api/teachers/students          → grupos con sus estudiantes
router.get('/students', getMyStudents);

// GET /api/teachers/students/:id/profile → perfil + progreso del estudiante
router.get('/students/:studentId/profile', getStudentProfile);

module.exports = router;
