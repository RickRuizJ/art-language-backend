jest.mock('../src/config/database',()=>({transaction:jest.fn(fn=>fn({LOCK:{UPDATE:'UPDATE'}}))}));
// Sprint 0 stabilization — tests for the configurable-attempts behavior
// requested in the technical review. Models and the grading service are
// mocked; this only protects the maxAttempts decision logic itself.

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const mockWorksheetFindByPk = jest.fn();
const mockSubmissionCount = jest.fn();
const mockSubmissionCreate = jest.fn();
const mockAssignmentFindOne = jest.fn();

jest.mock('../src/models', () => ({
  Submission: {
    count: (...a) => mockSubmissionCount(...a),
    create: (...a) => mockSubmissionCreate(...a),
    findAll: jest.fn(),
  },
  Worksheet: { findByPk: async (...a) => {const w=await mockWorksheetFindByPk(...a);return w?{questions:[{id:'q1',type:'short_answer',points:10}],...w,toJSON:()=>w}:null;} },
  User: { findByPk: jest.fn().mockResolvedValue({ groupId: null }) },
  Group: {},
  GroupMember: { findAll: jest.fn().mockResolvedValue([{ groupId: 'group-1' }]) },
  Assignment: { findOne: (...a) => mockAssignmentFindOne(...a) },
}));

jest.mock('../src/services/grading.service', () => ({
  gradeSubmission: jest.fn(),
}));

const gradingService = require('../src/services/grading.service');
const express = require('express');
const request = require('supertest');
const submissionController = require('../src/controllers/submissionController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'student-1' };
    next();
  });
  app.post('/submissions', submissionController.submitWorksheet);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmissionCreate.mockImplementation(async (data) => ({ ...data, id: 'sub-1' }));
  mockAssignmentFindOne.mockResolvedValue({ id: 'assignment-1' }); // la hoja está asignada al alumno
});

describe('POST /submissions — maxAttempts validation', () => {
  it('accepts a first attempt when maxAttempts = 1', async () => {
    mockWorksheetFindByPk.mockResolvedValue({ id: 'ws-1', maxAttempts: 1, autoGrade: false });
    mockSubmissionCount.mockResolvedValue(0);
    const app = buildApp();

    const res = await request(app).post('/submissions').send({ worksheetId: 'ws-1', answers: [] });

    expect(res.status).toBe(201);
    expect(res.body.data.attemptNumber).toBe(1);
    expect(res.body.data.attemptsRemaining).toBe(0);
  });

  it('rejects a second attempt when maxAttempts = 1', async () => {
    mockWorksheetFindByPk.mockResolvedValue({ id: 'ws-1', maxAttempts: 1, autoGrade: false });
    mockSubmissionCount.mockResolvedValue(1); // already submitted once
    const app = buildApp();

    const res = await request(app).post('/submissions').send({ worksheetId: 'ws-1', answers: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/maximum attempts/i);
    expect(mockSubmissionCreate).not.toHaveBeenCalled();
  });

  it('accepts a second attempt when maxAttempts = 2, and reports attemptsRemaining', async () => {
    mockWorksheetFindByPk.mockResolvedValue({ id: 'ws-1', maxAttempts: 2, autoGrade: false });
    mockSubmissionCount.mockResolvedValue(1);
    const app = buildApp();

    const res = await request(app).post('/submissions').send({ worksheetId: 'ws-1', answers: [] });

    expect(res.status).toBe(201);
    expect(res.body.data.attemptNumber).toBe(2);
    expect(res.body.data.attemptsRemaining).toBe(0);
  });

  it('rejects a third attempt when maxAttempts = 2', async () => {
    mockWorksheetFindByPk.mockResolvedValue({ id: 'ws-1', maxAttempts: 2, autoGrade: false });
    mockSubmissionCount.mockResolvedValue(2);
    const app = buildApp();

    const res = await request(app).post('/submissions').send({ worksheetId: 'ws-1', answers: [] });

    expect(res.status).toBe(400);
    expect(mockSubmissionCreate).not.toHaveBeenCalled();
  });

  it('always accepts submissions when maxAttempts is 0 (unlimited)', async () => {
    mockWorksheetFindByPk.mockResolvedValue({ id: 'ws-1', maxAttempts: 0, autoGrade: false });
    mockSubmissionCount.mockResolvedValue(50); // many previous attempts
    const app = buildApp();

    const res = await request(app).post('/submissions').send({ worksheetId: 'ws-1', answers: [] });

    expect(res.status).toBe(201);
    expect(res.body.data.attemptsRemaining).toBeNull();
  });

  it('always accepts submissions when maxAttempts is null (unlimited)', async () => {
    mockWorksheetFindByPk.mockResolvedValue({ id: 'ws-1', maxAttempts: null, autoGrade: false });
    mockSubmissionCount.mockResolvedValue(10);
    const app = buildApp();

    const res = await request(app).post('/submissions').send({ worksheetId: 'ws-1', answers: [] });

    expect(res.status).toBe(201);
    expect(res.body.data.attemptsRemaining).toBeNull();
  });

  it('routes grading through the unified gradingService when autoGrade is true', async () => {
    mockWorksheetFindByPk.mockResolvedValue({ id: 'ws-1', maxAttempts: 1, autoGrade: true });
    mockSubmissionCount.mockResolvedValue(0);
    gradingService.gradeSubmission.mockResolvedValue({
      score: 8,
      maxScore: 10,
      percentage: 80,
      feedback: [{ questionId: 'q1', correct: true, pointsEarned: 8, requiresManualReview: false }],
    });
    const app = buildApp();

    const res = await request(app)
      .post('/submissions')
      .send({ worksheetId: 'ws-1', answers: [{ questionId: 'q1', answer: 'b' }] });

    expect(res.status).toBe(201);
    expect(gradingService.gradeSubmission).toHaveBeenCalled();
    expect(res.body.data.score).toBe(8);
  });

  it('returns 404 when the worksheet does not exist', async () => {
    mockWorksheetFindByPk.mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app).post('/submissions').send({ worksheetId: 'missing', answers: [] });

    expect(res.status).toBe(404);
  });
});

describe('POST /submissions — permisos', () => {
  it('rechaza con 403 si la hoja no está asignada al alumno', async () => {
    mockWorksheetFindByPk.mockResolvedValue({ id: 'ws-1', maxAttempts: 1, autoGrade: false });
    mockAssignmentFindOne.mockResolvedValue(null);
    const res = await request(buildApp()).post('/submissions').send({ worksheetId: 'ws-1', answers: [] });
    expect(res.status).toBe(403);
    expect(mockSubmissionCreate).not.toHaveBeenCalled();
  });

  it('responde 409 ante un doble envío simultáneo', async () => {
    mockWorksheetFindByPk.mockResolvedValue({ id: 'ws-1', maxAttempts: 0, autoGrade: false });
    mockSubmissionCount.mockResolvedValue(0);
    mockSubmissionCreate.mockRejectedValue(Object.assign(new Error('dup'), { name: 'SequelizeUniqueConstraintError' }));
    const res = await request(buildApp()).post('/submissions').send({ worksheetId: 'ws-1', answers: [] });
    expect(res.status).toBe(409);
  });

  it('deja en manos del profesor la entrega con preguntas que requieren revisión', async () => {
    mockWorksheetFindByPk.mockResolvedValue({ id: 'ws-1', maxAttempts: 1, autoGrade: true });
    mockSubmissionCount.mockResolvedValue(0);
    gradingService.gradeSubmission.mockResolvedValue({
      score: 0, maxScore: 10, percentage: 0,
      feedback: [{ questionId: 'q1', correct: null, pointsEarned: 0, requiresManualReview: true }],
    });
    await request(buildApp()).post('/submissions').send({ worksheetId: 'ws-1', answers: [{ questionId: 'q1', answer: 'x' }] });
    expect(mockSubmissionCreate).toHaveBeenCalledWith(expect.objectContaining({ status: 'submitted' }),expect.any(Object));
  });
});
