// Sprint 0 stabilization — automated tests requested in the technical review.
// Scope: only the behavior that matters before starting Sprint 1
// (Interactive PDF Worksheet Engine). Not aiming for full coverage.

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const gradingService = require('../src/services/grading.service');

describe('GradingService', () => {
  describe('gradeQuestion — multiple_choice', () => {
    const question = { id: 'q1', type: 'multiple_choice', correctAnswer: 'b', points: 10 };

    it('awards full points for the correct option', () => {
      const result = gradingService.gradeQuestion(question, 'b');
      expect(result.correct).toBe(true);
      expect(result.pointsEarned).toBe(10);
    });

    it('awards zero points for an incorrect option', () => {
      const result = gradingService.gradeQuestion(question, 'a');
      expect(result.correct).toBe(false);
      expect(result.pointsEarned).toBe(0);
    });
  });

  describe('gradeQuestion — true_false', () => {
    const question = { id: 'q2', type: 'true_false', correctAnswer: 'true', points: 5 };

    it('is case-insensitive and trims whitespace', () => {
      const result = gradingService.gradeQuestion(question, '  TRUE  ');
      expect(result.correct).toBe(true);
      expect(result.pointsEarned).toBe(5);
    });

    it('accepts boolean answers matching a boolean correctAnswer', () => {
      const boolQuestion = { id: 'q2b', type: 'true_false', correctAnswer: false, points: 5 };
      const result = gradingService.gradeQuestion(boolQuestion, false);
      expect(result.correct).toBe(true);
    });

    it('marks a wrong answer as incorrect', () => {
      const result = gradingService.gradeQuestion(question, 'false');
      expect(result.correct).toBe(false);
      expect(result.pointsEarned).toBe(0);
    });
  });

  describe('gradeQuestion — fill_blank', () => {
    const question = { id: 'q3', type: 'fill_blank', correctAnswer: 'Paris', points: 8 };

    it('is case-insensitive by default', () => {
      const result = gradingService.gradeQuestion(question, 'paris');
      expect(result.correct).toBe(true);
      expect(result.pointsEarned).toBe(8);
    });

    it('accepts any answer in an array of acceptable answers', () => {
      const multiAnswer = { id: 'q3b', type: 'fill_blank', correctAnswer: ['color', 'colour'], points: 4 };
      expect(gradingService.gradeQuestion(multiAnswer, 'Colour').correct).toBe(true);
      expect(gradingService.gradeQuestion(multiAnswer, 'color').correct).toBe(true);
    });

    it('respects caseSensitive: true', () => {
      const strict = { id: 'q3c', type: 'fill_blank', correctAnswer: 'Paris', points: 8, caseSensitive: true };
      expect(gradingService.gradeQuestion(strict, 'paris').correct).toBe(false);
      expect(gradingService.gradeQuestion(strict, 'Paris').correct).toBe(true);
    });

    it('rejects non-string answers instead of throwing', () => {
      const result = gradingService.gradeQuestion(question, 123);
      expect(result.correct).toBe(false);
      expect(result.pointsEarned).toBe(0);
    });
  });

  describe('gradeQuestion — matching', () => {
    const question = {
      id: 'q4',
      type: 'matching',
      points: 10,
      pairs: [
        { left: 'dog', right: 'perro' },
        { left: 'cat', right: 'gato' },
      ],
    };

    it('awards full points when every pair matches', () => {
      const result = gradingService.gradeQuestion(question, { dog: 'perro', cat: 'gato' });
      expect(result.correct).toBe(true);
      expect(result.pointsEarned).toBe(10);
    });

    it('awards partial credit for partially correct matches', () => {
      const result = gradingService.gradeQuestion(question, { dog: 'perro', cat: 'wrong' });
      expect(result.correct).toBe(false);
      expect(result.pointsEarned).toBe(5);
    });

    it('rejects a non-object answer instead of throwing', () => {
      const result = gradingService.gradeQuestion(question, null);
      expect(result.correct).toBe(false);
      expect(result.pointsEarned).toBe(0);
    });
  });

  describe('gradeQuestion — unknown type', () => {
    it('does not throw and returns zero points', () => {
      const result = gradingService.gradeQuestion({ id: 'q5', type: 'not_a_real_type', points: 10 }, 'anything');
      expect(result.correct).toBe(false);
      expect(result.pointsEarned).toBe(0);
    });
  });

  describe('gradeSubmission', () => {
    const worksheet = {
      passScore: 70,
      questions: [
        { id: 'q1', type: 'multiple_choice', correctAnswer: 'b', points: 10 },
        { id: 'q2', type: 'true_false', correctAnswer: 'true', points: 10 },
      ],
    };

    it('totals score/maxScore across mixed question types', () => {
      const result = gradingService.gradeSubmission(worksheet, { q1: 'b', q2: 'false' });
      return result.then((r) => {
        expect(r.score).toBe(10);
        expect(r.maxScore).toBe(20);
        expect(r.percentage).toBe(50);
        expect(r.passed).toBe(false);
      });
    });

    it('rejects a worksheet with no questions array', async () => {
      await expect(gradingService.gradeSubmission({}, {})).rejects.toThrow('Invalid worksheet');
    });

    it('rejects a non-object answers payload', async () => {
      await expect(gradingService.gradeSubmission(worksheet, null)).rejects.toThrow('Invalid answers format');
    });
  });
});
