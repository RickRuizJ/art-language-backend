const express = require('express');
const router = express.Router();
const worksheetController = require('../controllers/worksheetController');
const uploadController = require('../controllers/uploadController');
const auth = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');

// All routes require authentication
router.use(auth);

// ─── Static POST routes FIRST (before any /:id catch-all) ───────────────────
router.post('/upload', roleCheck('teacher', 'admin'), uploadController.uploadWorksheet);
router.post('/external-link', roleCheck('teacher', 'admin'), uploadController.saveExternalLink);
router.post('/google-link', roleCheck('teacher', 'admin'), uploadController.saveGoogleLink);

const interactive = require('../controllers/interactiveController');
router.put('/:id/interactive', roleCheck('teacher', 'admin'), interactive.saveLayout);
router.post('/:id/attempt', roleCheck('student'), interactive.startAttempt);
router.put('/:id/draft', roleCheck('student'), interactive.saveDraft);

// ─── Collection routes ───────────────────────────────────────────────────────
router.get('/', worksheetController.getWorksheets);
router.post('/', roleCheck('teacher', 'admin'), worksheetController.createWorksheet);

// ─── Single-resource routes (/:id) ──────────────────────────────────────────
router.get('/:id', worksheetController.getWorksheet);
router.get('/:id/file', uploadController.getWorksheetFile);
router.put('/:id', roleCheck('teacher', 'admin'), worksheetController.updateWorksheet);
router.delete('/:id', roleCheck('teacher', 'admin'), worksheetController.deleteWorksheet);
router.post('/:id/publish', roleCheck('teacher', 'admin'), worksheetController.togglePublish);

module.exports = router;
