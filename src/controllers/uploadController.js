const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('../config/cloudinary');
const { Op } = require('sequelize');
const { buildLinkResource, LinkError } = require('../utils/links');
const { Worksheet, Workbook, WorkbookWorksheet, FileUpload, Assignment, GroupMember, User } = require('../models');
const logger = require('../config/logger');

// ─── Multer — memory storage (no disk writes; Render has no persistent FS) ──
const ALLOWED_MIMES = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.ms-powerpoint': '.ppt',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'video/mp4': '.mp4',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const EXT_TO_MIME = Object.entries(ALLOWED_MIMES).reduce((acc, [mime, ext]) => { acc[ext] = mime; return acc; }, { '.jpeg': 'image/jpeg' });

// Windows/Safari a veces envían .docx como application/octet-stream: si el tipo
// es desconocido se decide por la extensión; cualquier otra combinación se rechaza.
function resolveMime(file) {
  const ext = require('path').extname(file.originalname || '').toLowerCase();
  const byExt = EXT_TO_MIME[ext] || null;

  // Windows/Safari may send CSV as application/vnd.ms-excel. Prefer the
  // explicit .csv extension so Cloudinary/file metadata remain CSV rather
  // than silently renaming it to .xls.
  if (ext === '.csv' && file.mimetype === 'application/vnd.ms-excel') return 'text/csv';

  if (ALLOWED_MIMES[file.mimetype]) return file.mimetype;
  if (!file.mimetype || file.mimetype === 'application/octet-stream') return byExt;
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (resolveMime(file)) {
      cb(null, true);
    } else {
      cb(new Error('File type not supported. Allowed: PDF, Word, Excel, PowerPoint, TXT, CSV, MP3, MP4, PNG, JPG, GIF, WEBP'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ─── SPRINT 0 FIX ───────────────────────────────────────────────────────────
// Previously: files were base64-encoded and stored directly in the Postgres
// `file_uploads.file_path` TEXT column (via bufferToDataUrl). This does not
// scale ("hundreds of thousands of worksheets") and left the already-
// configured Cloudinary client (src/config/cloudinary.js) completely unused.
//
// FIX: stream the buffer to Cloudinary and store only the returned secure_url
// + public_id in Postgres. `resource_type: 'auto'` lets Cloudinary handle
// PDFs (as 'raw'/'image') and image types correctly without us branching.
function uploadBufferToCloudinary(buffer, { folder, filename, mimetype }) {
  return new Promise((resolve, reject) => {
    const isImage = mimetype.startsWith('image/');
    const resourceType = isImage ? 'image' : 'raw';
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        // Raw resources (PDF/DOC/DOCX) should keep their extension so the
        // delivery URL preserves the correct file type/content disposition.
        public_id: resourceType === 'raw' ? filename : filename.replace(/\.[^/.]+$/, ''),
        resource_type: resourceType,
        overwrite: false,
      },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });
}

// ─── Optional workbook link ──────────────────────────────────────────────────
async function resolveWorkbook(workbookId, userId) {
  if (!workbookId) return null;
  const workbook = await Workbook.findOne({ where: { id: workbookId, createdBy: userId } });
  if (!workbook) throw new Error('Workbook not found or access denied');
  return workbook.id;
}

async function linkToWorkbook(workbookId, worksheetId) {
  if (!workbookId) return;
  const maxOrder = await WorkbookWorksheet.max('displayOrder', { where: { workbookId } });
  await WorkbookWorksheet.create({
    workbookId,
    worksheetId,
    displayOrder: (maxOrder || 0) + 1,
  });
}

async function studentCanAccessFile(studentId, worksheetId) {
  const [memberships, student] = await Promise.all([
    GroupMember.findAll({ where: { studentId }, attributes: ['groupId'] }),
    User.findByPk(studentId, { attributes: ['groupId'] })
  ]);
  const groupIds = [...new Set([...memberships.map(m => m.groupId), student?.groupId].filter(Boolean))];
  if (!groupIds.length) return false;
  return !!(await Assignment.findOne({
    where: {
      worksheetId,
      groupId: { [Op.in]: groupIds },
      isActive: { [Op.ne]: false }
    },
    attributes: ['id']
  }));
}

// ─── POST /api/worksheets/upload ──────────────────────────────────────────────
// FIXED: Better error handling, ensure workbook link, validate file size
exports.uploadWorksheet = [
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file uploaded. Please select a file.',
        });
      }

      const { title, description, subject, gradeLevel, workbookId } = req.body;

      if (!title || !title.trim()) {
        return res.status(400).json({ success: false, message: 'Title is required.' });
      }
      // 10MB multer limit above is now the only size gate — no separate
      // base64 5MB cap needed since we no longer store the file in Postgres.

      const fileId   = uuidv4();
      const mimeType = resolveMime(req.file);
      const originalExt = require('path').extname(req.file.originalname || '').toLowerCase();
      const ext = EXT_TO_MIME[originalExt] ? originalExt : (ALLOWED_MIMES[mimeType] || '');
      const filename = `${fileId}${ext}`;

      logger.info(`[UPLOAD] User ${req.user.id} uploading file: ${req.file.originalname} (${req.file.size} bytes)`);

      // CRITICAL FIX: Ensure workbook exists
      const finalWorkbookId = await resolveWorkbook(workbookId, req.user.id);
      if (finalWorkbookId) logger.info(`[UPLOAD] Assigned to workbook: ${finalWorkbookId}`);

      // Validate upload integration here so the rest of the LMS can stay online
      // even if Cloudinary environment variables are missing.
      cloudinary.assertConfigured?.();

      // Upload the actual bytes to Cloudinary — Postgres never sees the file.
      const cloudinaryResult = await uploadBufferToCloudinary(req.file.buffer, {
        folder: `art-language/worksheets/${req.user.id}`,
        filename,
        mimetype: mimeType,
      });
      logger.info(`[UPLOAD] Cloudinary stored: ${cloudinaryResult.secure_url}`);

      // 1) Persist file record — filePath now holds the Cloudinary secure_url,
      //    not a base64 data URL.
      const fileRecord = await FileUpload.create({
        id: fileId,
        filename,
        originalFilename: req.file.originalname,
        filePath: cloudinaryResult.secure_url,
        fileSize: req.file.size,
        mimeType,
        uploadedBy: req.user.id,
        entityType: 'worksheet',
        isPublic: false,
      });

      // 2) Create the worksheet
      const worksheet = await Worksheet.create({
        title: title.trim(),
        description: description ? description.trim() : null,
        subject: subject || null,
        gradeLevel: gradeLevel || null,
        createdBy: req.user.id,
        isPublished: false,
        questions: [],       // uploaded files have no interactive questions
        autoGrade: false,
        difficulty: 'beginner',
      });

      logger.info(`[UPLOAD] Created worksheet: ${worksheet.id}`);

      // 3) Link file → worksheet
      await fileRecord.update({ entityId: worksheet.id });

      // 4) Link to a workbook only when the teacher selected one.
      await linkToWorkbook(finalWorkbookId, worksheet.id);
      if (finalWorkbookId) logger.info(`[UPLOAD] Linked worksheet ${worksheet.id} to workbook ${finalWorkbookId}`);

      res.status(201).json({
        success: true,
        message: 'Worksheet uploaded successfully',
        data: {
          worksheet: {
            ...worksheet.toJSON(),
            file: {
              id: fileRecord.id,
              originalFilename: fileRecord.originalFilename,
              mimeType: fileRecord.mimeType,
              fileSize: fileRecord.fileSize,
            },
            workbookId: finalWorkbookId,
          },
        },
      });
    } catch (error) {
      logger.error('[UPLOAD ERROR] Full error:', error);
      logger.error(`[UPLOAD ERROR] Name: ${error.name}`);
      logger.error(`[UPLOAD ERROR] Message: ${error.message}`);
      if (error.stack) logger.error(`[UPLOAD ERROR] Stack: ${error.stack}`);
      if (error.parent) logger.error('[UPLOAD ERROR] DB error:', error.parent);
      
      if (error.message && error.message.includes('File type not supported')) {
        return res.status(400).json({ success: false, message: error.message });
      }
      
      if (error.message && error.message.includes('Workbook not found')) {
        return res.status(404).json({ success: false, message: error.message });
      }

      if (error.message && error.message.includes('Missing Cloudinary configuration')) {
        return res.status(503).json({
          success: false,
          message: error.message + '. Configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in the backend host.'
        });
      }
      
      res.status(500).json({ 
        success: false, 
        message: 'Upload failed. Please try again.' 
      });
    }
  },
];

// ─── POST /api/worksheets/external-link ───────────────────────────────────────
// Stores any http(s) learning resource. Google Docs/Sheets/Slides receive an
// embed URL; other links are presented as a safe "Open resource" link because
// many websites intentionally block iframe embedding.
exports.saveExternalLink = async (req, res) => {
  try {
    const { title, url, description, subject, gradeLevel, workbookId } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ success: false, message: 'Title is required.' });
    if (!url || !url.trim()) return res.status(400).json({ success: false, message: 'Link is required.' });

    // Acepta cualquier http(s) (también sin "https://"), detecta Google, YouTube y Vimeo.
    let built;
    try { built = buildLinkResource(url); } catch (err) {
      if (err instanceof LinkError) return res.status(400).json({ success: false, message: err.message });
      throw err;
    }
    const parsed = new URL(built.originalUrl);
    const finalWorkbookId = await resolveWorkbook(workbookId, req.user.id);
    const resource = { ...built, host: parsed.hostname };

    const worksheet = await Worksheet.create({
      title: title.trim(),
      description: description?.trim() || `External resource · ${parsed.hostname}`,
      subject: subject || null,
      gradeLevel: gradeLevel || null,
      createdBy: req.user.id,
      isPublished: false,
      questions: [resource],
      autoGrade: false,
      difficulty: 'beginner',
    });

    await linkToWorkbook(finalWorkbookId, worksheet.id);
    return res.status(201).json({
      success: true,
      message: 'Link saved successfully',
      data: { worksheet: worksheet.toJSON(), workbookId: finalWorkbookId }
    });
  } catch (error) {
    logger.error('[EXTERNAL LINK ERROR]', error);
    if (error.message?.includes('Workbook not found')) return res.status(404).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: 'Failed to save link' });
  }
};

// Backward-compatible alias for old clients.
exports.saveGoogleLink = exports.saveExternalLink;

// ─── GET /api/worksheets/:id/file ─────────────────────────────────────────────
// Returns the Cloudinary URL for an uploaded file so the frontend can render it.
// SPRINT 0 FIX: `filePath` now holds a Cloudinary secure_url instead of a
// base64 data URL. We keep `dataUrl` in the response for backward
// compatibility with the current frontend (it just treats it as a URL /
// <iframe src> already), and add `fileUrl` as the clearer forward-looking key.
//
// TODO
// Eliminar completamente dataUrl cuando el frontend utilice únicamente fileUrl.
//
// Objetivo:
// Sprint 1 o Sprint 2.
exports.getWorksheetFile = async (req, res) => {
  try {
    const fileRecord = await FileUpload.findOne({
      where: {
        entityType: 'worksheet',
        entityId: req.params.id,
      },
    });

    if (!fileRecord) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    const worksheet = await Worksheet.findByPk(req.params.id, { attributes: ['id', 'createdBy', 'isPublished'] });
    if (!worksheet) return res.status(404).json({ success: false, message: 'Worksheet not found' });
    if (req.user.role === 'teacher' && worksheet.createdBy !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (req.user.role === 'student') {
      const allowed = worksheet.isPublished && await studentCanAccessFile(req.user.id, worksheet.id);
      if (!allowed) return res.status(404).json({ success: false, message: 'File not found' });
    }

    res.json({
      success: true,
      data: {
        id: fileRecord.id,
        originalFilename: fileRecord.originalFilename,
        mimeType: fileRecord.mimeType,
        fileSize: fileRecord.fileSize,
        fileUrl: fileRecord.filePath,
        dataUrl: fileRecord.filePath, // TODO: eliminar — ver nota arriba (objetivo Sprint 1 o 2)
      },
    });
  } catch (error) {
    logger.error('Get file error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch file' });
  }
};
