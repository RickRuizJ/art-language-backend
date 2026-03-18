'use strict';
/**
 * routes/assignmentRoutes.js
 *
 * BUGS FIXED:
 * 1. `const { protect } = require('../middleware/auth')` — `protect` was not
 *    exported as a named export from auth.js. It's now exported as an alias.
 *
 * 2. `submitAssignment` was imported from assignmentController but was never
 *    defined there. The app would crash at startup when loading this file.
 *    FIX: assignmentController now exports a stub `submitAssignment`.
 *
 * NOTE: This file is registered as a route file but was never mounted in
 * app.js! The group assignment routes are handled by groups.js (which
 * already includes them inline). This file is kept for standalone
 * /api/assignments endpoints if needed in the future.
 *
 * It is safe to mount or ignore this file — currently app.js does not mount
 * it, so it has no effect on production. The group assignment routes in
 * groups.js handle all assignment CRUD correctly.
 */

const express = require('express');
const router  = express.Router();
const {
  getStudentAssignments,
  getGroupAssignments,
  createAssignment,
  submitAssignment,
  deleteAssignment
} = require('../controllers/assignmentController');
const { protect } = require('../middleware/auth');

router.use(protect);

// GET /api/students/:studentId/assignments
router.get('/students/:studentId/assignments', getStudentAssignments);

// GET  /api/groups/:groupId/assignments
router.get('/groups/:groupId/assignments', getGroupAssignments);

// POST /api/groups/:groupId/assignments
router.post('/groups/:groupId/assignments', createAssignment);

// DELETE /api/groups/:groupId/assignments/:assignmentId
router.delete('/groups/:groupId/assignments/:assignmentId', deleteAssignment);

// PUT /api/assignments/:assignmentId/submit
router.put('/assignments/:assignmentId/submit', submitAssignment);

module.exports = router;
