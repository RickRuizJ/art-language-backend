const Worksheet = require('../models/Worksheet');

/**
 * GET /worksheets
 * Supports ?search=&level=&topic=&skill=&subject=&gradeLevel=&page=&limit=
 * Teachers see their own worksheets; students see all published ones.
 */
const getWorksheets = async (req, res) => {
  try {
    const {
      search, level, topic, skill,
      subject, gradeLevel, difficulty,
      page = 1, limit = 20,
    } = req.query;

    const query = {};

    // Role-based visibility
    if (req.user.role === 'teacher') {
      query.createdBy = req.user.id;
    } else {
      query.isPublished = true;
    }

    // Keyword search across title, description, topic
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { topic: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
      ];
    }

    // Exact / regex filters
    if (level) query.level = level.toUpperCase();
    if (topic) query.topic = { $regex: topic, $options: 'i' };
    if (skill) query.skill = { $regex: skill, $options: 'i' };
    if (subject) query.subject = { $regex: subject, $options: 'i' };
    if (gradeLevel) query.gradeLevel = { $regex: gradeLevel, $options: 'i' };
    if (difficulty) query.difficulty = difficulty;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [worksheets, total] = await Promise.all([
      Worksheet.find(query)
        .populate('createdBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Worksheet.countDocuments(query),
    ]);

    const formatted = worksheets.map(w => ({ ...w, id: w._id }));

    res.status(200).json({
      status: 'success',
      data: {
        worksheets: formatted,
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
    const worksheet = await Worksheet.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email')
      .lean();

    if (!worksheet) {
      return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });
    }

    // Students can only see published worksheets
    if (req.user.role === 'student' && !worksheet.isPublished) {
      return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });
    }
    // Teachers can only edit their own
    if (req.user.role === 'teacher' && worksheet.createdBy?._id?.toString() !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'Access denied.' });
    }

    res.status(200).json({ status: 'success', data: { worksheet: { ...worksheet, id: worksheet._id } } });
  } catch (err) {
    console.error('getWorksheet error:', err);
    res.status(500).json({ status: 'error', message: 'Server error.' });
  }
};

/**
 * POST /worksheets
 * Creates a new worksheet (teacher only).
 */
const createWorksheet = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ status: 'error', message: 'Only teachers can create worksheets.' });
    }

    const {
      title, description, subject, gradeLevel,
      difficulty, estimatedTime, autoGrade, passScore,
      level, topic, skill, questions,
      isPublished,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ status: 'error', message: 'Title is required.' });
    }
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ status: 'error', message: 'At least one question is required.' });
    }

    const worksheet = new Worksheet({
      title: title.trim(),
      description: description?.trim(),
      subject: subject?.trim(),
      gradeLevel: gradeLevel?.trim(),
      difficulty: difficulty || 'beginner',
      estimatedTime: estimatedTime || 30,
      autoGrade: autoGrade !== false,
      passScore: passScore || 70,
      level: level?.toUpperCase() || '',
      topic: topic?.trim() || '',
      skill: skill?.toLowerCase() || '',
      questions,
      createdBy: req.user.id,
      isPublished: isPublished !== false,
    });

    await worksheet.save();

    const populated = await Worksheet.findById(worksheet._id)
      .populate('createdBy', 'firstName lastName')
      .lean();

    res.status(201).json({
      status: 'success',
      data: { worksheet: { ...populated, id: populated._id } },
    });
  } catch (err) {
    console.error('createWorksheet error:', err);
    res.status(500).json({ status: 'error', message: 'Server error creating worksheet.' });
  }
};

/**
 * PUT /worksheets/:id
 * Updates an existing worksheet (teacher only, must be owner).
 */
const updateWorksheet = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ status: 'error', message: 'Only teachers can update worksheets.' });
    }

    const worksheet = await Worksheet.findById(req.params.id);
    if (!worksheet) return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });

    if (worksheet.createdBy?.toString() !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'You do not own this worksheet.' });
    }

    const updatable = [
      'title', 'description', 'subject', 'gradeLevel', 'difficulty',
      'estimatedTime', 'autoGrade', 'passScore', 'level', 'topic',
      'skill', 'questions', 'isPublished',
    ];

    updatable.forEach(field => {
      if (req.body[field] !== undefined) {
        worksheet[field] = req.body[field];
      }
    });

    await worksheet.save();

    const populated = await Worksheet.findById(worksheet._id)
      .populate('createdBy', 'firstName lastName')
      .lean();

    res.status(200).json({
      status: 'success',
      data: { worksheet: { ...populated, id: populated._id } },
    });
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

    const worksheet = await Worksheet.findById(req.params.id);
    if (!worksheet) return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });

    if (worksheet.createdBy?.toString() !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'You do not own this worksheet.' });
    }

    await worksheet.deleteOne();
    res.status(200).json({ status: 'success', data: null });
  } catch (err) {
    console.error('deleteWorksheet error:', err);
    res.status(500).json({ status: 'error', message: 'Server error.' });
  }
};

/**
 * POST /worksheets/:id/publish
 * Toggles publish state (teacher only).
 */
const togglePublish = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ status: 'error', message: 'Only teachers can publish worksheets.' });
    }

    const worksheet = await Worksheet.findById(req.params.id);
    if (!worksheet) return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });
    if (worksheet.createdBy?.toString() !== req.user.id) {
      return res.status(403).json({ status: 'error', message: 'Access denied.' });
    }

    worksheet.isPublished = !worksheet.isPublished;
    await worksheet.save();

    res.status(200).json({
      status: 'success',
      data: { worksheet: { id: worksheet._id, isPublished: worksheet.isPublished } },
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
