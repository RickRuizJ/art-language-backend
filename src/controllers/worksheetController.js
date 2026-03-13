const { Op } = require('sequelize');
const Worksheet = require('../models/Worksheet');
const User = require('../models/User');

/**
 * GET /worksheets
 */
const getWorksheets = async (req, res) => {
  try {
    const {
      search, level, topic, skill,
      subject, gradeLevel, difficulty,
      page = 1, limit = 20,
    } = req.query;

    const where = {};

    if (req.user.role === 'teacher') {
      where.created_by = req.user.id;
    } else {
      where.is_published = true;
    }

    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
        { topic: { [Op.iLike]: `%${search}%` } },
        { subject: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (level) where.level = level.toUpperCase();
    if (topic) where.topic = { [Op.iLike]: `%${topic}%` };
    if (skill) where.skill = { [Op.iLike]: `%${skill}%` };
    if (subject) where.subject = { [Op.iLike]: `%${subject}%` };
    if (gradeLevel) where.grade_level = { [Op.iLike]: `%${gradeLevel}%` };
    if (difficulty) where.difficulty = difficulty;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { rows: worksheets, count: total } = await Worksheet.findAndCountAll({
      where,
      include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] }],
      order: [['createdAt', 'DESC']],
      offset,
      limit: parseInt(limit),
    });

    res.status(200).json({
      status: 'success',
      data: {
        worksheets,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('getWorksheets error:', err);
    res.status(500).json({ status: 'error', message: 'Server error retrieving worksheets.' });
  }
};

/**
 * GET /worksheets/:id
 */
const getWorksheet = async (req, res) => {
  try {
    const worksheet = await Worksheet.findByPk(req.params.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] }],
    });

    if (!worksheet) {
      return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });
    }

    if (req.user.role === 'student' && !worksheet.is_published) {
      return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });
    }

    if (req.user.role === 'teacher' && worksheet.created_by !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'Access denied.' });
    }

    res.status(200).json({ status: 'success', data: { worksheet } });
  } catch (err) {
    console.error('getWorksheet error:', err);
    res.status(500).json({ status: 'error', message: 'Server error.' });
  }
};

/**
 * POST /worksheets
 */
const createWorksheet = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ status: 'error', message: 'Only teachers can create worksheets.' });
    }

    const {
      title, description, subject, gradeLevel,
      difficulty, estimatedTime, autoGrade, passScore,
      level, topic, skill, questions, isPublished,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ status: 'error', message: 'Title is required.' });
    }
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ status: 'error', message: 'At least one question is required.' });
    }

    const worksheet = await Worksheet.create({
      title: title.trim(),
      description: description?.trim(),
      subject: subject?.trim(),
      grade_level: gradeLevel?.trim(),
      difficulty: difficulty || 'beginner',
      estimated_time: estimatedTime || 30,
      auto_grade: autoGrade !== false,
      pass_score: passScore || 70,
      level: level?.toUpperCase() || '',
      topic: topic?.trim() || '',
      skill: skill?.toLowerCase() || '',
      questions,
      created_by: req.user.id,
      is_published: isPublished !== false,
    });

    const populated = await Worksheet.findByPk(worksheet.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] }],
    });

    res.status(201).json({ status: 'success', data: { worksheet: populated } });
  } catch (err) {
    console.error('createWorksheet error:', err);
    res.status(500).json({ status: 'error', message: 'Server error creating worksheet.' });
  }
};

/**
 * PUT /worksheets/:id
 */
const updateWorksheet = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ status: 'error', message: 'Only teachers can update worksheets.' });
    }

    const worksheet = await Worksheet.findByPk(req.params.id);
    if (!worksheet) return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });

    if (worksheet.created_by !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'You do not own this worksheet.' });
    }

    const fieldMap = {
      title: 'title', description: 'description', subject: 'subject',
      gradeLevel: 'grade_level', difficulty: 'difficulty',
      estimatedTime: 'estimated_time', autoGrade: 'auto_grade',
      passScore: 'pass_score', level: 'level', topic: 'topic',
      skill: 'skill', questions: 'questions', isPublished: 'is_published',
    };

    Object.entries(fieldMap).forEach(([bodyKey, dbKey]) => {
      if (req.body[bodyKey] !== undefined) worksheet[dbKey] = req.body[bodyKey];
    });

    await worksheet.save();

    const populated = await Worksheet.findByPk(worksheet.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] }],
    });

    res.status(200).json({ status: 'success', data: { worksheet: populated } });
  } catch (err) {
    console.error('updateWorksheet error:', err);
    res.status(500).json({ status: 'error', message: 'Server error updating worksheet.' });
  }
};

/**
 * DELETE /worksheets/:id
 */
const deleteWorksheet = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ status: 'error', message: 'Only teachers can delete worksheets.' });
    }

    const worksheet = await Worksheet.findByPk(req.params.id);
    if (!worksheet) return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });

    if (worksheet.created_by !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'You do not own this worksheet.' });
    }

    await worksheet.destroy();
    res.status(200).json({ status: 'success', data: null });
  } catch (err) {
    console.error('deleteWorksheet error:', err);
    res.status(500).json({ status: 'error', message: 'Server error.' });
  }
};

/**
 * POST /worksheets/:id/publish
 */
const togglePublish = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ status: 'error', message: 'Only teachers can publish worksheets.' });
    }

    const worksheet = await Worksheet.findByPk(req.params.id);
    if (!worksheet) return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });

    if (worksheet.created_by !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'Access denied.' });
    }

    worksheet.is_published = !worksheet.is_published;
    await worksheet.save();

    res.status(200).json({
      status: 'success',
      data: { worksheet: { id: worksheet.id, isPublished: worksheet.is_published } },
    });
  } catch (err) {
    console.error('togglePublish error:', err);
    res.status(500).json({ status: 'error', message: 'Server error.' });
  }
};

module.exports = {
  getWorksheets,
  getWorksheet,
  createWorksheet,
  updateWorksheet,
  deleteWorksheet,
  togglePublish,
};
