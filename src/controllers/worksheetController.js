const { body, validationResult } = require('express-validator');
const Worksheet = require('../models/Worksheet');
const User = require('../models/User');
const { Op } = require('sequelize');

// @route   GET /api/worksheets
// @desc    Get all worksheets (with filters)
// @access  Private
exports.getWorksheets = async (req, res) => {
  try {
    const { subject, gradeLevel, difficulty, search } = req.query;
    const where = {};

    // Only teachers see their own drafts, students see published only
    if (req.user.role === 'student') {
      where.isPublished = true;
    } else if (req.user.role === 'teacher') {
      where.createdBy = req.user.id;
    }

    if (subject) where.subject = subject;
    if (gradeLevel) where.gradeLevel = gradeLevel;
    if (difficulty) where.difficulty = difficulty;
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const worksheets = await Worksheet.findAll({
      where,
      include: [{
        model: User,
        as: 'creator',
        attributes: ['id', 'firstName', 'lastName', 'email']
      }],
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: { worksheets }
    });
  } catch (error) {
    console.error('Get worksheets error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};

// @route   GET /api/worksheets/:id
// @desc    Get single worksheet
// @access  Private
exports.getWorksheet = async (req, res) => {
  try {
    const worksheet = await Worksheet.findByPk(req.params.id, {
      include: [{
        model: User,
        as: 'creator',
        attributes: ['id', 'firstName', 'lastName', 'email']
      }]
    });

    if (!worksheet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Worksheet not found' 
      });
    }

    // Check permissions
    if (req.user.role === 'student' && !worksheet.isPublished) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    if (req.user.role === 'teacher' && worksheet.createdBy !== req.user.id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    res.json({
      success: true,
      data: { worksheet }
    });
  } catch (error) {
    console.error('Get worksheet error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};

// @route   POST /api/worksheets
// @desc    Create worksheet
// @access  Private (Teacher, Admin)
exports.createWorksheet = [
  body('title').notEmpty().trim(),
  body('questions').isArray({ min: 1 }),

  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false, 
          errors: errors.array() 
        });
      }

      const worksheet = await Worksheet.create({
        ...req.body,
        createdBy: req.user.id
      });

      res.status(201).json({
        success: true,
        message: 'Worksheet created successfully',
        data: { worksheet }
      });
    } catch (error) {
      console.error('Create worksheet error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Server error' 
      });
    }
  }
];

// @route   PUT /api/worksheets/:id
// @desc    Update worksheet
// @access  Private (Teacher, Admin)
exports.updateWorksheet = async (req, res) => {
  try {
    const worksheet = await Worksheet.findByPk(req.params.id);

    if (!worksheet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Worksheet not found' 
      });
    }

    // Check ownership
    if (worksheet.createdBy !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    await worksheet.update(req.body);

    res.json({
      success: true,
      message: 'Worksheet updated successfully',
      data: { worksheet }
    });
  } catch (error) {
    console.error('Update worksheet error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};

// @route   DELETE /api/worksheets/:id
// @desc    Delete worksheet
// @access  Private (Teacher, Admin)
exports.deleteWorksheet = async (req, res) => {
  try {
    const worksheet = await Worksheet.findByPk(req.params.id);

    if (!worksheet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Worksheet not found' 
      });
    }

    // Check ownership
    if (worksheet.createdBy !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    await worksheet.destroy();

    res.json({
      success: true,
      message: 'Worksheet deleted successfully'
    });
  } catch (error) {
    console.error('Delete worksheet error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};

// @route   POST /api/worksheets/:id/publish
// @desc    Publish/unpublish worksheet
// @access  Private (Teacher, Admin)
exports.togglePublish = async (req, res) => {
  try {
    const worksheet = await Worksheet.findByPk(req.params.id);

    if (!worksheet) {
      return res.status(404).json({ 
        success: false, 
        message: 'Worksheet not found' 
      });
    }

    // Check ownership
    if (worksheet.createdBy !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied' 
      });
    }

    await worksheet.update({ 
      isPublished: !worksheet.isPublished 
    });

    res.json({
      success: true,
      message: `Worksheet ${worksheet.isPublished ? 'published' : 'unpublished'} successfully`,
      data: { worksheet }
    });
  } catch (error) {
    console.error('Toggle publish error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
};
