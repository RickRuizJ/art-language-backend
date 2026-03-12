const express = require('express');
const router = express.Router();
const {
  getStudentAssignments,
  getGroupAssignments,
  createAssignment,
  submitAssignment,
  deleteAssignment,
} = require('../controllers/assignmentController');
const { protect } = require('../middleware/auth');

// All routes require a valid JWT
router.use(protect);

// ── Student assignment list ─────────────────────────────────────────────────
// GET /api/students/:studentId/assignments
router.get('/students/:studentId/assignments', getStudentAssignments);

// ── Group assignment CRUD ───────────────────────────────────────────────────
// GET  /api/groups/:groupId/assignments
router.get('/groups/:groupId/assignments', getGroupAssignments);

// POST /api/groups/:groupId/assignments   (teacher)
router.post('/groups/:groupId/assignments', createAssignment);

// DELETE /api/groups/:groupId/assignments/:assignmentId   (teacher)
router.delete('/groups/:groupId/assignments/:assignmentId', deleteAssignment);

// ── Submit ─────────────────────────────────────────────────────────────────
// PUT /api/assignments/:assignmentId/submit   (student)
router.put('/assignments/:assignmentId/submit', submitAssignment);

module.exports = router;
