const express = require('express');
const router = express.Router();
const worksheetController = require('../controllers/worksheetController');
const auth = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');

// All routes require authentication
router.use(auth);

// Get all worksheets
router.get('/', worksheetController.getWorksheets);

// Get single worksheet
router.get('/:id', worksheetController.getWorksheet);

// Create worksheet (Teacher, Admin only)
router.post('/', roleCheck('teacher', 'admin'), worksheetController.createWorksheet);

// Update worksheet (Teacher, Admin only)
router.put('/:id', roleCheck('teacher', 'admin'), worksheetController.updateWorksheet);

// Delete worksheet (Teacher, Admin only)
router.delete('/:id', roleCheck('teacher', 'admin'), worksheetController.deleteWorksheet);

// Publish/unpublish worksheet (Teacher, Admin only)
router.post('/:id/publish', roleCheck('teacher', 'admin'), worksheetController.togglePublish);

module.exports = router;
