// =====================================================
// AGREGAR AL FINAL DE: backend/src/routes/groups.js
// (Antes de module.exports = router)
// =====================================================

const assignmentController = require('../controllers/assignmentController');

// ─── Assignment Routes ────────────────────────────────────────

// Assign worksheet to group
router.post('/:groupId/assignments', 
  roleCheck('teacher', 'admin'),
  assignmentController.assignWorksheet
);

// Get group assignments  
router.get('/:groupId/assignments',
  assignmentController.getGroupAssignments
);

// Remove assignment
router.delete('/:groupId/assignments/:assignmentId',
  roleCheck('teacher', 'admin'),
  assignmentController.removeAssignment
);

// ─────────────────────────────────────────────────────────────

module.exports = router;
