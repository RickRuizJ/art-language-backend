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
const { randomUUID } = require('crypto');
const { Worksheet, User, Workbook, WorkbookWorksheet, Assignment, GroupMember } = require('../models');
const logger    = require('../config/logger');


function normalizeQuestions(questions = []) {
  return questions.map((q) => ({
    ...q,
    id: q.id || q._id || randomUUID(),
    text: q.text || q.question || '',
    points: Number.isFinite(Number(q.points)) ? Number(q.points) : 10,
  }));
}

const {publicQuestion,publicWorksheet}=require('../services/interactive.service');
function sanitizeQuestionsForStudent(questions=[]){return questions.map((q,i)=>publicQuestion({...q,id:q.id||`legacy-${i+1}`}));}

async function studentCanAccessWorksheet(studentId, worksheetId) {
  const [memberships, student] = await Promise.all([
    GroupMember.findAll({ where: { studentId }, attributes: ['groupId'] }),
    User.findByPk(studentId, { attributes: ['groupId'] })
  ]);
  const groupIds = [...new Set([
    ...memberships.map(m => m.groupId),
    student?.groupId
  ].filter(Boolean))];
  if (!groupIds.length) return false;
  const assignment = await Assignment.findOne({
    where: {
      worksheetId,
      groupId: { [Op.in]: groupIds },
      isActive: { [Op.ne]: false }
    },
    attributes: ['id']
  });
  return !!assignment;
}

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
      const [memberships, student] = await Promise.all([
        GroupMember.findAll({ where: { studentId: req.user.id }, attributes: ['groupId'] }),
        User.findByPk(req.user.id, { attributes: ['groupId'] })
      ]);
      const groupIds = [...new Set([...memberships.map(m => m.groupId), student?.groupId].filter(Boolean))];
      if (!groupIds.length) {
        where.id = { [Op.in]: [] };
      } else {
        const assigned = await Assignment.findAll({
          where: { groupId: { [Op.in]: groupIds }, isActive: { [Op.ne]: false } },
          attributes: ['worksheetId']
        });
        where.id = { [Op.in]: [...new Set(assigned.map(a => a.worksheetId))] };
      }
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

    const queryOptions = {
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
    };
    if (req.user.role === 'student') queryOptions.attributes = { exclude: ['questions'] };
    const { rows: worksheets, count: total } = await Worksheet.findAndCountAll(queryOptions);

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
    logger.error('getWorksheets error:', err);
    res.status(500).json({ success: false, message: 'Server error retrieving worksheets.' });
  }
};

// ─── GET /api/worksheets/:id ──────────────────────────────────────────────────
const getWorksheet = async (req, res) => {
  try {
    const worksheet = await Worksheet.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'firstName', 'lastName', 'email']
        },
        {
          model: Workbook,
          as: 'workbooks',
          attributes: ['id', 'title'],
          through: { attributes: ['displayOrder'] },
          required: false
        }
      ]
    });

    if (!worksheet) {
      return res.status(404).json({ success: false, message: 'Worksheet not found.' });
    }

    // Students may only open worksheets explicitly assigned to one of their groups.
    if (req.user.role === 'student') {
      const allowed = worksheet.isPublished && await studentCanAccessWorksheet(req.user.id, worksheet.id);
      if (!allowed) {
        return res.status(404).json({ success: false, message: 'Worksheet not found.' });
      }
      const payload = worksheet.toJSON();
      payload.questions = sanitizeQuestionsForStudent(payload.questions || []);
      if (payload.creator) delete payload.creator.email;
      return res.status(200).json({ success: true, data: { worksheet: payload } });
    }

    // Teachers can only see their own worksheets
    if (req.user.role === 'teacher' && worksheet.createdBy !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    res.status(200).json({ success: true, data: { worksheet } });
  } catch (err) {
    logger.error('getWorksheet error:', err);
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
      title, description, instructions, subject, gradeLevel,
      difficulty, estimatedTime, autoGrade, passScore,
      questions, isPublished, maxAttempts
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
      instructions:  instructions?.trim() || null,
      subject:       subject?.trim() || null,
      gradeLevel:    gradeLevel?.trim() || null,
      difficulty:    difficulty || 'beginner',
      estimatedTime: estimatedTime || 30,
      autoGrade:     autoGrade !== false,
      passScore:     passScore || 70,
      questions: normalizeQuestions(questions),
      createdBy:     req.user.id,
      isPublished:   isPublished !== false,
      maxAttempts:   maxAttempts !== undefined ? maxAttempts : 1
    });

    const populated = await Worksheet.findByPk(worksheet.id, {
      include: [{ model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] }]
    });

    res.status(201).json({ success: true, data: { worksheet: populated } });
  } catch (err) {
    logger.error('createWorksheet error:', err);
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

    if(worksheet.interactiveLayout && req.body.questions !== undefined)return res.status(400).json({success:false,message:'Edit PDF fields through Make Interactive.'});
    const allowed = [
      'title', 'description', 'instructions', 'subject', 'gradeLevel',
      'difficulty', 'estimatedTime', 'autoGrade', 'passScore',
      'questions', 'isPublished', 'maxAttempts'
    ];
    allowed.forEach(f => {
      if (req.body[f] !== undefined) {
        worksheet[f] = f === 'questions' ? normalizeQuestions(req.body[f]) : req.body[f];
      }
    });
    await worksheet.save();

    // The edit screen exposes a single workbook selector. Keep that UI and the
    // M:N junction table in sync by replacing this worksheet's workbook link.
    if (req.body.workbookId !== undefined) {
      let selectedWorkbook = null;

      if (req.body.workbookId) {
        const workbookWhere = { id: req.body.workbookId };
        if (req.user.role === 'teacher') workbookWhere.createdBy = req.user.id;

        selectedWorkbook = await Workbook.findOne({ where: workbookWhere });
        if (!selectedWorkbook) {
          return res.status(404).json({ success: false, message: 'Workbook not found or access denied.' });
        }
      }

      await WorkbookWorksheet.destroy({ where: { worksheetId: worksheet.id } });

      if (selectedWorkbook) {
        const maxOrder = await WorkbookWorksheet.max('displayOrder', {
          where: { workbookId: selectedWorkbook.id }
        });
        await WorkbookWorksheet.create({
          workbookId: selectedWorkbook.id,
          worksheetId: worksheet.id,
          displayOrder: (maxOrder || 0) + 1
        });
      }
    }

    const populated = await Worksheet.findByPk(worksheet.id, {
      include: [
        { model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName'] },
        { model: Workbook, as: 'workbooks', attributes: ['id', 'title'], through: { attributes: [] }, required: false }
      ]
    });

    res.status(200).json({ success: true, data: { worksheet: populated } });
  } catch (err) {
    logger.error('updateWorksheet error:', err);
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
    logger.error('deleteWorksheet error:', err);
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
    logger.error('togglePublish error:', err);
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
