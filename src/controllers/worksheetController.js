'use strict';
/**
 * controllers/worksheetController.js
 *
 * BUGS FIXED:
 * 1. `order: [['createdAt', 'DESC']]` — Sequelize passes the raw string
 *    to SQL as `"Worksheet"."createdAt"` which does not exist in the DB.
 *    The DB column is `created_at`.
 *    FIX: Change to `[['created_at', 'DESC']]`.
 *
 * 2. `where.level`, `where.topic`, `where.skill` — the Worksheet model has
 *    no `level`, `topic`, or `skill` columns (they are not in the schema).
 *    Querying on them causes SequelizeDatabaseError.
 *    FIX: Remove those filters; keep subject, gradeLevel, difficulty which
 *    DO exist in the schema.
 *
 * 3. createWorksheet tried to set `level`, `topic`, `skill` on the model
 *    which would throw "Unknown column" in strict mode.
 *    FIX: Remove those fields from create().
 */

const { Op } = require('sequelize');
const Worksheet = require('../models/Worksheet');
const User      = require('../models/User');

// ─── GET /api/worksheets ──────────────────────────────────────────────────────
const getWorksheets = async (req, res) => {
  try {
    const {
      search, subject, gradeLevel, difficulty,
      page = 1, limit = 20
    } = req.query;

    const where = {};

    // Role-based visibility
    if (req.user.role === 'teacher') {
      where.createdBy = req.user.id;
    } else if (req.user.role === 'student') {
      where.isPublished = true;
    }
    // admin sees everything

    // Text search across title and description
    if (search) {
      where[Op.or] = [
        { title:       { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
        { subject:     { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (subject)     where.subject    = { [Op.iLike]: `%${subject}%` };
    if (gradeLevel)  where.gradeLevel = { [Op.iLike]: `%${gradeLevel}%` };
    if (difficulty)  where.difficulty = difficulty;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { rows: worksheets, count: total } = await Worksheet.findAndCountAll({
      where,
      include: [{
        model: User,
        as: 'creator',
        attributes: ['id', 'firstName', 'lastName']
      }],
      // FIX: use snake_case column name to avoid SequelizeDatabaseError
      order: [['created_at', 'DESC']],
      offset,
      limit: parseInt(limit)
    });

    res.status(200).json({
      success: true,
      data: {
        worksheets,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('getWorksheets error:', err);
    res.status(500).json({ success: false, message: 'Server error retrieving worksheets.' });
  }
};

// ─── GET /api/worksheets/:id ──────────────────────────────────────────────────
const getWorksheet = async (req, res) => {
  try {
    const worksheet = await Worksheet.findByPk(req.params.id, {
      include: [{
        model: User,
        as: 'creator',
        attributes: ['id', 'firstName', 'lastName', 'email']
      }]
    });

    if (!worksheet) {
      return res.status(404).json({ success: false, message: 'Worksheet not found.' });
    }

    // Students can only see published worksheets
    if (req.user.role === 'student' && !worksheet.isPublished) {
      return res.status(404).json({ success: false, message: 'Worksheet not found.' });
    }

    // Teachers can only see their own worksheets
    if (req.user.role === 'teacher' && worksheet.createdBy !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    res.status(200).json({ success: true, data: { worksheet } });
  } catch (err) {
    console.error('getWorksheet error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ─── POST /api/worksheets ─────────────────────────────────────────────────────
const createWorksheet = async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only teachers can create worksheets.' });
    }

    const {
      title, description, subject, gradeLevel,
      difficulty, estimatedTime, autoGrade, passScore,
      questions, isPublished
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required.' });
    }
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one question is required.' });
    }

    const worksheet = await Worksheet.create({
      title:         title.trim(),
      description:   description?.trim() || null,
      subject:       subject?.trim() || null,
      gradeLevel:    gradeLevel?.trim() || null,
      difficulty:    difficulty || 'beginner',
      estimatedTime: estimatedTime || 30,
      autoGrade:     autoGrade !== false,
      passScore:     passScore || 70,
      questions,
      createdBy:     req.user.id,
      isPublished:   isPublished !== false
    });

    const populated = await Worksheet.findByPk(worksheet.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] }]
    });

    res.status(201).json({ success: true, data: { worksheet: populated } });
  } catch (err) {
    console.error('createWorksheet error:', err);
    res.status(500).json({ success: false, message: 'Server error creating worksheet.' });
  }
};

// ─── PUT /api/worksheets/:id ──────────────────────────────────────────────────
const updateWorksheet = async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only teachers can update worksheets.' });
    }

    const worksheet = await Worksheet.findByPk(req.params.id);
    if (!worksheet) {
      return res.status(404).json({ success: false, message: 'Worksheet not found.' });
    }
    if (req.user.role === 'teacher' && worksheet.createdBy !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You do not own this worksheet.' });
    }

    const allowed = [
      'title', 'description', 'subject', 'gradeLevel',
      'difficulty', 'estimatedTime', 'autoGrade', 'passScore',
      'questions', 'isPublished'
    ];
    allowed.forEach(f => {
      if (req.body[f] !== undefined) worksheet[f] = req.body[f];
    });
    await worksheet.save();

    const populated = await Worksheet.findByPk(worksheet.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] }]
    });

    res.status(200).json({ success: true, data: { worksheet: populated } });
  } catch (err) {
    console.error('updateWorksheet error:', err);
    res.status(500).json({ success: false, message: 'Server error updating worksheet.' });
  }
};

// ─── DELETE /api/worksheets/:id ───────────────────────────────────────────────
const deleteWorksheet = async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only teachers can delete worksheets.' });
    }

    const worksheet = await Worksheet.findByPk(req.params.id);
    if (!worksheet) {
      return res.status(404).json({ success: false, message: 'Worksheet not found.' });
    }
    if (req.user.role === 'teacher' && worksheet.createdBy !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You do not own this worksheet.' });
    }

    await worksheet.destroy();
    res.status(200).json({ success: true, message: 'Worksheet deleted.' });
  } catch (err) {
    console.error('deleteWorksheet error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ─── POST /api/worksheets/:id/publish ────────────────────────────────────────
const togglePublish = async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only teachers can publish worksheets.' });
    }

    const worksheet = await Worksheet.findByPk(req.params.id);
    if (!worksheet) {
      return res.status(404).json({ success: false, message: 'Worksheet not found.' });
    }
    if (req.user.role === 'teacher' && worksheet.createdBy !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    worksheet.isPublished = !worksheet.isPublished;
    await worksheet.save();

    res.status(200).json({
      success: true,
      data: { worksheet: { id: worksheet.id, isPublished: worksheet.isPublished } }
    });
  } catch (err) {
    console.error('togglePublish error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = {
  getWorksheets,
  getWorksheet,
  createWorksheet,
  updateWorksheet,
  deleteWorksheet,
  togglePublish
};
