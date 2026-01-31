const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const workbookController = require('../controllers/workbookController');

// All routes require authentication
router.use(auth);

// Get all workbooks
router.get('/', workbookController.getAllWorkbooks);

// Get single workbook
router.get('/:id', workbookController.getWorkbookById);

// Create workbook (Teacher, Admin only)
router.post('/', roleCheck('teacher', 'admin'), workbookController.createWorkbook);

// Update workbook (Teacher, Admin only)
router.put('/:id', roleCheck('teacher', 'admin'), workbookController.updateWorkbook);

// Delete workbook (Teacher, Admin only)
router.delete('/:id', roleCheck('teacher', 'admin'), workbookController.deleteWorkbook);

// Add worksheet to workbook
router.post(
  '/:workbookId/worksheets/:worksheetId',
  roleCheck('teacher', 'admin'),
  workbookController.addWorksheetToWorkbook
);

// Remove worksheet from workbook
router.delete(
  '/:workbookId/worksheets/:worksheetId',
  roleCheck('teacher', 'admin'),
  workbookController.removeWorksheetFromWorkbook
);

// Reorder worksheets
router.put(
  '/:workbookId/reorder',
  roleCheck('teacher', 'admin'),
  workbookController.reorderWorksheets
);

// Toggle publish status
router.post(
  '/:id/publish',
  roleCheck('teacher', 'admin'),
  workbookController.togglePublish
);

module.exports = router;
