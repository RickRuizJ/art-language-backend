// Sprint 0 stabilization — tests for the Cloudinary upload flow requested in
// the technical review. Cloudinary and the Sequelize models are mocked; no
// network or database access happens in this test file.

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const mockUploadStream = jest.fn();
jest.mock('../src/config/cloudinary', () => ({
  uploader: {
    upload_stream: (...args) => mockUploadStream(...args),
  },
}));

const mockWorkbookFindOne = jest.fn();
const mockWorkbookCreate = jest.fn();
const mockFileUploadCreate = jest.fn();
const mockWorksheetCreate = jest.fn();
const mockWorkbookWorksheetMax = jest.fn();
const mockWorkbookWorksheetCreate = jest.fn();

jest.mock('../src/models', () => ({
  Worksheet: { create: (...a) => mockWorksheetCreate(...a) },
  Workbook: {
    findOne: (...a) => mockWorkbookFindOne(...a),
    create: (...a) => mockWorkbookCreate(...a),
  },
  WorkbookWorksheet: {
    max: (...a) => mockWorkbookWorksheetMax(...a),
    create: (...a) => mockWorkbookWorksheetCreate(...a),
  },
  FileUpload: { create: (...a) => mockFileUploadCreate(...a) },
}));

const express = require('express');
const request = require('supertest');
const uploadController = require('../src/controllers/uploadController');
const errorHandler = require('../src/middleware/errorHandler');

function buildApp() {
  const app = express();
  app.use((req, res, next) => {
    req.user = { id: 'teacher-1' };
    next();
  });
  app.post('/upload', uploadController.uploadWorksheet);
  // multer's fileFilter errors are passed to next(err), bypassing the
  // controller's own try/catch — mirror the real app.js pipeline here.
  app.use(errorHandler);
  return app;
}

const FAKE_CLOUDINARY_URL = 'https://res.cloudinary.com/demo/raw/upload/v1/art-language/worksheets/teacher-1/fake.pdf';

beforeEach(() => {
  jest.clearAllMocks();

  // upload_stream((error, result) => ...) returns a writable-like object with .end()
  mockUploadStream.mockImplementation((options, callback) => ({
    end: () => callback(null, { secure_url: FAKE_CLOUDINARY_URL, public_id: 'fake' }),
  }));

  mockWorkbookFindOne.mockResolvedValue({ id: 'workbook-1' });
  mockFileUploadCreate.mockResolvedValue({
    id: 'file-1',
    originalFilename: 'worksheet.pdf',
    mimeType: 'application/pdf',
    fileSize: 1234,
    filePath: FAKE_CLOUDINARY_URL,
    update: jest.fn().mockResolvedValue(true),
  });
  mockWorksheetCreate.mockResolvedValue({
    id: 'worksheet-1',
    toJSON: () => ({ id: 'worksheet-1', title: 'My Worksheet' }),
  });
  mockWorkbookWorksheetMax.mockResolvedValue(0);
  mockWorkbookWorksheetCreate.mockResolvedValue({ id: 'ww-1' });
});

describe('POST /upload (uploadWorksheet)', () => {
  it('uploads the file buffer to Cloudinary and stores the returned secure_url, never a base64 dataUrl', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/upload')
      .field('title', 'My Worksheet')
      .field('workbookId', 'workbook-1')
      .attach('file', Buffer.from('%PDF-1.4 fake pdf content'), {
        filename: 'worksheet.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(201);
    expect(mockUploadStream).toHaveBeenCalled();

    // The record persisted to Postgres must carry the Cloudinary URL as filePath,
    // never a base64 data: URL.
    const persistedArgs = mockFileUploadCreate.mock.calls[0][0];
    expect(persistedArgs.filePath).toBe(FAKE_CLOUDINARY_URL);
    expect(persistedArgs.filePath.startsWith('data:')).toBe(false);
  });

  it('rejects requests with no file attached', async () => {
    const app = buildApp();
    const res = await request(app).post('/upload').field('title', 'No File Here');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockUploadStream).not.toHaveBeenCalled();
  });

  it('rejects requests with no title', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('%PDF-1.4 fake'), {
        filename: 'worksheet.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/title/i);
  });

  it('returns 404 when an explicit workbookId does not belong to the user', async () => {
    mockWorkbookFindOne.mockResolvedValueOnce(null);
    const app = buildApp();

    const res = await request(app)
      .post('/upload')
      .field('title', 'Orphan Upload')
      .field('workbookId', 'someone-elses-workbook')
      .attach('file', Buffer.from('%PDF-1.4 fake'), {
        filename: 'worksheet.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(404);
  });

  it('sube sin workbook cuando no se elige ninguno (el workbook es opcional)', async () => {
    const app = buildApp();

    const res = await request(app)
      .post('/upload')
      .field('title', 'No Workbook Given')
      .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'worksheet.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(mockWorkbookCreate).not.toHaveBeenCalled();
    expect(mockWorkbookWorksheetCreate).not.toHaveBeenCalled();
  });

  it('acepta un .docx aunque el navegador lo envíe como octet-stream', async () => {
    const res = await request(buildApp())
      .post('/upload')
      .field('title', 'Word')
      .attach('file', Buffer.from('PK'), { filename: 't.docx', contentType: 'application/octet-stream' });
    expect(res.status).toBe(201);
  });

  it('rejects unsupported file types before ever calling Cloudinary', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/upload')
      .field('title', 'Bad Type')
      .attach('file', Buffer.from('not a real file'), {
        filename: 'malware.exe',
        contentType: 'application/x-msdownload',
      });

    // multer's fileFilter rejects the file before the handler ever runs, so
    // Cloudinary must never be touched. NOTE: the error currently surfaces as
    // a 500 via the global error handler (errorHandler.js defaults to 500
    // when err.status is unset) rather than a 400 — that status-code mapping
    // is pre-existing behavior untouched by Sprint 0 and outside this PR's
    // scope, but is left documented here as a candidate for a future PR.
    expect(res.status).toBe(400); // errorHandler traduce el rechazo de tipo a 400
    expect(res.body.success).toBe(false);
    expect(mockUploadStream).not.toHaveBeenCalled();
  });
});
