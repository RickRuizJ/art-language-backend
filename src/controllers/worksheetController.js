const { Op } = require('sequelize');
const Worksheet = require('../models/Worksheet');
const User = require('../models/User');

const getWorksheets = async (req, res) => {
  try {
    const { search, level, topic, skill, subject, gradeLevel, difficulty, page = 1, limit = 20 } = req.query;
    const where = {};
    if (req.user.role === 'teacher') { where.createdBy = req.user.id; } else { where.isPublished = true; }
    if (search) { where[Op.or] = [{ title: { [Op.iLike]: `%${search}%` } }, { description: { [Op.iLike]: `%${search}%` } }, { topic: { [Op.iLike]: `%${search}%` } }, { subject: { [Op.iLike]: `%${search}%` } }]; }
    if (level) where.level = level.toUpperCase();
    if (topic) where.topic = { [Op.iLike]: `%${topic}%` };
    if (skill) where.skill = { [Op.iLike]: `%${skill}%` };
    if (subject) where.subject = { [Op.iLike]: `%${subject}%` };
    if (gradeLevel) where.gradeLevel = { [Op.iLike]: `%${gradeLevel}%` };
    if (difficulty) where.difficulty = difficulty;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { rows: worksheets, count: total } = await Worksheet.findAndCountAll({ where, include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] }], order: [['createdAt', 'DESC']], offset, limit: parseInt(limit) });
    res.status(200).json({ status: 'success', data: { worksheets, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) } });
  } catch (err) { console.error('getWorksheets error:', err); res.status(500).json({ status: 'error', message: 'Server error retrieving worksheets.' }); }
};

const getWorksheet = async (req, res) => {
  try {
    console.log('getWorksheet called, id:', req.params.id);
    const worksheet = await Worksheet.findByPk(req.params.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] }],
    });
    console.log('findByPk result:', worksheet ? 'FOUND' : 'NOT FOUND');
    if (!worksheet) return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });
    if (req.user.role === 'student' && !worksheet.isPublished) return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });
    if (req.user.role === 'teacher' && worksheet.createdBy !== req.user.id) return res.status(403).json({ status: 'error', message: 'Access denied.' });
    res.status(200).json({ status: 'success', data: { worksheet } });
  } catch (err) { console.error('getWorksheet error:', err); res.status(500).json({ status: 'error', message: 'Server error.' }); }
};

const createWorksheet = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') return res.status(403).json({ status: 'error', message: 'Only teachers can create worksheets.' });
    const { title, description, subject, gradeLevel, difficulty, estimatedTime, autoGrade, passScore, level, topic, skill, questions, isPublished } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ status: 'error', message: 'Title is required.' });
    if (!questions || !Array.isArray(questions) || questions.length === 0) return res.status(400).json({ status: 'error', message: 'At least one question is required.' });
    const worksheet = await Worksheet.create({ title: title.trim(), description: description?.trim(), subject: subject?.trim(), gradeLevel: gradeLevel?.trim(), difficulty: difficulty || 'beginner', estimatedTime: estimatedTime || 30, autoGrade: autoGrade !== false, passScore: passScore || 70, level: level?.toUpperCase() || '', topic: topic?.trim() || '', skill: skill?.toLowerCase() || '', questions, createdBy: req.user.id, isPublished: isPublished !== false });
    const populated = await Worksheet.findByPk(worksheet.id, { include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] }] });
    res.status(201).json({ status: 'success', data: { worksheet: populated } });
  } catch (err) { console.error('createWorksheet error:', err); res.status(500).json({ status: 'error', message: 'Server error creating worksheet.' }); }
};

const updateWorksheet = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') return res.status(403).json({ status: 'error', message: 'Only teachers can update worksheets.' });
    const worksheet = await Worksheet.findByPk(req.params.id);
    if (!worksheet) return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });
    if (worksheet.createdBy !== req.user.id) return res.status(403).json({ status: 'error', message: 'You do not own this worksheet.' });
    ['title','description','subject','gradeLevel','difficulty','estimatedTime','autoGrade','passScore','level','topic','skill','questions','isPublished'].forEach(f => { if (req.body[f] !== undefined) worksheet[f] = req.body[f]; });
    await worksheet.save();
    const populated = await Worksheet.findByPk(worksheet.id, { include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] }] });
    res.status(200).json({ status: 'success', data: { worksheet: populated } });
  } catch (err) { console.error('updateWorksheet error:', err); res.status(500).json({ status: 'error', message: 'Server error updating worksheet.' }); }
};

const deleteWorksheet = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') return res.status(403).json({ status: 'error', message: 'Only teachers can delete worksheets.' });
    const worksheet = await Worksheet.findByPk(req.params.id);
    if (!worksheet) return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });
    if (worksheet.createdBy !== req.user.id) return res.status(403).json({ status: 'error', message: 'You do not own this worksheet.' });
    await worksheet.destroy();
    res.status(200).json({ status: 'success', data: null });
  } catch (err) { console.error('deleteWorksheet error:', err); res.status(500).json({ status: 'error', message: 'Server error.' }); }
};

const togglePublish = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') return res.status(403).json({ status: 'error', message: 'Only teachers can publish worksheets.' });
    const worksheet = await Worksheet.findByPk(req.params.id);
    if (!worksheet) return res.status(404).json({ status: 'error', message: 'Worksheet not found.' });
    if (worksheet.createdBy !== req.user.id) return res.status(403).json({ status: 'error', message: 'Access denied.' });
    worksheet.isPublished = !worksheet.isPublished;
    await worksheet.save();
    res.status(200).json({ status: 'success', data: { worksheet: { id: worksheet.id, isPublished: worksheet.isPublished } } });
  } catch (err) { console.error('togglePublish error:', err); res.status(500).json({ status: 'error', message: 'Server error.' }); }
};

module.exports = { getWorksheets, getWorksheet, createWorksheet, updateWorksheet, deleteWorksheet, togglePublish };
