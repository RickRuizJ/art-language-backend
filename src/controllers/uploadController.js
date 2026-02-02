const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const Worksheet = require('../models/Worksheet');
const { FileUpload, WorkbookWorksheet, Workbook } = require('../models/Workbook');

// ─── Multer — memory storage (no disk writes; Railway has no persistent FS) ─
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

// ─── Helper ───────────────────────────────────────────────────────────────────
function bufferToDataUrl(buffer, mimetype) {
  return `data:${mimetype};base64,${buffer.toString('base64')}`;
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

      // CRITICAL FIX: Ensure file is not too large for base64 storage
      if (req.file.size > 5 * 1024 * 1024) { // 5MB limit for base64
        return res.status(400).json({ 
          success: false, 
          message: 'File too large for upload. Maximum size is 5MB.' 
        });
      }

      const fileId   = uuidv4();
      const ext      = ALLOWED_MIMES[req.file.mimetype] || '';
      const filename = `${fileId}${ext}`;
      const dataUrl  = bufferToDataUrl(req.file.buffer, req.file.mimetype);

      console.log(`[UPLOAD] User ${req.user.id} uploading file: ${req.file.originalname} (${req.file.size} bytes)`);

      // CRITICAL FIX: Ensure workbook exists
      const finalWorkbookId = await ensureWorkbook(workbookId, req.user.id);
      console.log(`[UPLOAD] Assigned to workbook: ${finalWorkbookId}`);

      // 1) Persist file record
      const fileRecord = await FileUpload.create({
        id: fileId,
        filename,
        originalFilename: req.file.originalname,
        filePath: dataUrl,
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

      console.log(`[UPLOAD] Created worksheet: ${worksheet.id}`);

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

      console.log(`[UPLOAD] Linked worksheet ${worksheet.id} to workbook ${finalWorkbookId}`);

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
      console.error('[UPLOAD ERROR] Full error:', error);
      console.error('[UPLOAD ERROR] Name:', error.name);
      console.error('[UPLOAD ERROR] Message:', error.message);
      if (error.stack) console.error('[UPLOAD ERROR] Stack:', error.stack);
      if (error.parent) console.error('[UPLOAD ERROR] DB error:', error.parent);
      
      if (error.message && error.message.includes('File type not supported')) {
        return res.status(400).json({ success: false, message: error.message });
      }
      
      if (error.message && error.message.includes('Workbook not found')) {
        return res.status(404).json({ success: false, message: error.message });
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

    console.log(`[GOOGLE LINK] User ${req.user.id} saving link: ${url.substring(0, 50)}...`);

    // CRITICAL FIX: Ensure workbook exists
    const finalWorkbookId = await ensureWorkbook(workbookId, req.user.id);
    console.log(`[GOOGLE LINK] Assigned to workbook: ${finalWorkbookId}`);

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

    console.log(`[GOOGLE LINK] Created worksheet: ${worksheet.id}`);

    // CRITICAL FIX: ALWAYS add to workbook
    const maxOrder = await WorkbookWorksheet.max('displayOrder', { 
      where: { workbookId: finalWorkbookId } 
    });
    
    await WorkbookWorksheet.create({
      workbookId: finalWorkbookId,
      worksheetId: worksheet.id,
      displayOrder: (maxOrder || 0) + 1,
    });

    console.log(`[GOOGLE LINK] Linked worksheet ${worksheet.id} to workbook ${finalWorkbookId}`);

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
    console.error('[GOOGLE LINK ERROR]', error);
    
    if (error.message && error.message.includes('Workbook not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    
    res.status(500).json({ success: false, message: 'Failed to save Google link' });
  }
};

// ─── GET /api/worksheets/:id/file ─────────────────────────────────────────────
// Returns the base64 data-URL for an uploaded file so the frontend can render it.
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
        dataUrl: fileRecord.filePath,
      },
    });
  } catch (error) {
    console.error('Get file error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch file' });
  }
};
