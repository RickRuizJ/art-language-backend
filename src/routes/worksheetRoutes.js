const express = require('express');
const router = express.Router();
const {
  getWorksheets,
  getWorksheet,
  createWorksheet,
  updateWorksheet,
  deleteWorksheet,
  togglePublish,
} = require('../controllers/worksheetController');
const { protect } = require('../middleware/auth');

router.use(protect);

// GET  /api/worksheets?search=food&level=A2&topic=travel&skill=vocabulary
router.get('/', getWorksheets);

// GET  /api/worksheets/:id
router.get('/:id', getWorksheet);

// POST /api/worksheets
router.post('/', createWorksheet);

// PUT  /api/worksheets/:id
router.put('/:id', updateWorksheet);

// DELETE /api/worksheets/:id
router.delete('/:id', deleteWorksheet);

// POST /api/worksheets/:id/publish
router.post('/:id/publish', togglePublish);

module.exports = router;
