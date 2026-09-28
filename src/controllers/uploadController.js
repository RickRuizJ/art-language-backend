const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const cloudinary = require('../config/cloudinary');
const { Worksheet, Workbook, WorkbookWorksheet, FileUpload } = require('../models');
const logger = require('../config/logger');

// ─── Multer — memory storage (no disk writes; Render has no persistent FS) ──
const ALLOWED_MIMES = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error('File type not supported. Allowed: PDF, DOCX, DOC, PNG, JPG, GIF, WEBP'), false);
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
    const resourceType = mimetype === 'application/pdf' ? 'raw' : 'auto';
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: filename.replace(/\.[^/.]+$/, ''),
        resource_type: resourceType,
        overwrite: false,
      },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    stream.end(buffer);
  });
}

// ─── CRITICAL FIX: Ensure workbook exists or create default ──────────────────
async function ensureWorkbook(workbookId, userId) {
  if (workbookId) {
    // Verify workbook exists and user has access
    const workbook = await Workbook.findOne({
      where: { id: workbookId, createdBy: userId }
    });
    if (!workbook) {
      throw new Error('Workbook not found or access denied');
    }
    return workbookId;
  }

  // CRITICAL: Create or get default workbook (worksheets MUST belong to a workbook)
  let defaultWorkbook = await Workbook.findOne({
    where: { 
      createdBy: userId,
      title: 'Mis Worksheets'
    }
  });

  if (!defaultWorkbook) {
    defaultWorkbook = await Workbook.create({
      title: 'Mis Worksheets',
      description: 'Worksheets sin organizar',
      createdBy: userId,
      status: 'draft',
      isActive: true
    });
  }

  return defaultWorkbook.id;
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
      const ext      = ALLOWED_MIMES[req.file.mimetype] || '';
      const filename = `${fileId}${ext}`;

      logger.info(`[UPLOAD] User ${req.user.id} uploading file: ${req.file.originalname} (${req.file.size} bytes)`);

      // CRITICAL FIX: Ensure workbook exists
      const finalWorkbookId = await ensureWorkbook(workbookId, req.user.id);
      logger.info(`[UPLOAD] Assigned to workbook: ${finalWorkbookId}`);

      // Validate upload integration here so the rest of the LMS can stay online
      // even if Cloudinary environment variables are missing.
      cloudinary.assertConfigured?.();

      // Upload the actual bytes to Cloudinary — Postgres never sees the file.
      const cloudinaryResult = await uploadBufferToCloudinary(req.file.buffer, {
        folder: `art-language/worksheets/${req.user.id}`,
        filename,
        mimetype: req.file.mimetype,
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
        mimeType: req.file.mimetype,
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

      // 4) CRITICAL FIX: ALWAYS link to workbook
      const maxOrder = await WorkbookWorksheet.max('displayOrder', { 
        where: { workbookId: finalWorkbookId } 
      });
      
      await WorkbookWorksheet.create({
        workbookId: finalWorkbookId,
        worksheetId: worksheet.id,
        displayOrder: (maxOrder || 0) + 1,
      });

      logger.info(`[UPLOAD] Linked worksheet ${worksheet.id} to workbook ${finalWorkbookId}`);

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

// ─── POST /api/worksheets/google-link ─────────────────────────────────────────
// FIXED: Ensure workbook link, better validation
exports.saveGoogleLink = async (req, res) => {
  try {
    const { title, url, description, subject, gradeLevel, workbookId } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required.' });
    }
    if (!url || !url.trim()) {
      return res.status(400).json({ success: false, message: 'Google link is required.' });
    }

    const googlePattern = /^https:\/\/(docs\.google\.com|sheets\.google\.com|slides\.google\.com)\//i;
    if (!googlePattern.test(url.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Google link. Please use a valid Google Docs, Sheets, or Slides URL.',
      });
    }

    logger.info(`[GOOGLE LINK] User ${req.user.id} saving link: ${url.substring(0, 50)}...`);

    // CRITICAL FIX: Ensure workbook exists
    const finalWorkbookId = await ensureWorkbook(workbookId, req.user.id);
    logger.info(`[GOOGLE LINK] Assigned to workbook: ${finalWorkbookId}`);

    // Detect type
    let googleType = 'doc';
    if (url.includes('sheets.google.com'))  googleType = 'sheet';
    if (url.includes('slides.google.com'))  googleType = 'slide';

    // Build embed URL (strip /edit, append the right pub param)
    let embedUrl = url.trim().replace(/\/edit.*$/, '').replace(/\/$/, '');
    if (!embedUrl.includes('/pub') && !embedUrl.includes('/embed')) {
      if (googleType === 'doc')   embedUrl += '/pub?embedded=true';
      if (googleType === 'sheet') embedUrl += '/pub?output=html';
      if (googleType === 'slide') embedUrl += '/embed';
    }

    const typeLabel = { doc: 'Doc', sheet: 'Sheet', slide: 'Slide' };

    // Create worksheet — questions field carries the Google metadata
    const worksheet = await Worksheet.create({
      title: title.trim(),
      description: description ? description.trim() : `Google ${typeLabel[googleType]}`,
      subject: subject || null,
      gradeLevel: gradeLevel || null,
      createdBy: req.user.id,
      isPublished: false,
      questions: [{
        type: 'google_embed',
        googleType,
        originalUrl: url.trim(),
        embedUrl,
      }],
      autoGrade: false,
      difficulty: 'beginner',
    });

    logger.info(`[GOOGLE LINK] Created worksheet: ${worksheet.id}`);

    // CRITICAL FIX: ALWAYS add to workbook
    const maxOrder = await WorkbookWorksheet.max('displayOrder', { 
      where: { workbookId: finalWorkbookId } 
    });
    
    await WorkbookWorksheet.create({
      workbookId: finalWorkbookId,
      worksheetId: worksheet.id,
      displayOrder: (maxOrder || 0) + 1,
    });

    logger.info(`[GOOGLE LINK] Linked worksheet ${worksheet.id} to workbook ${finalWorkbookId}`);

    res.status(201).json({
      success: true,
      message: 'Google link saved successfully',
      data: {
        worksheet: worksheet.toJSON(),
        googleType,
        embedUrl,
        workbookId: finalWorkbookId,
      },
    });
  } catch (error) {
    logger.error('[GOOGLE LINK ERROR]', error);
    
    if (error.message && error.message.includes('Workbook not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    
    res.status(500).json({ success: false, message: 'Failed to save Google link' });
  }
};

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
