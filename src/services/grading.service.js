const logger = require('../config/logger');

/**
 * Grading Service
 * 
 * Server-side autograde engine for worksheets
 * SECURITY: All grading logic MUST run server-side
 * 
 * Supports 5 question types:
 * - multiple-choice
 * - checkbox
 * - short-answer
 * - matching
 * - ordering
 */
class GradingService {
  
  /**
   * Grade a complete submission
   * @param {Object} worksheet - Worksheet with questions
   * @param {Object} answers - Student's answers { questionId: answer }
   * @returns {Object} { score, maxScore, percentage, feedback }
   */
  async gradeSubmission(worksheet, answers) {
    try {
      if (!worksheet || !worksheet.questions) {
        throw new Error('Invalid worksheet');
      }

      if (!answers || typeof answers !== 'object') {
        throw new Error('Invalid answers format');
      }

      const questions = worksheet.questions;
      let totalScore = 0;
      let maxScore = 0;
      const feedback = [];

      for (const question of questions) {
        maxScore += question.points || 0;
        
        const studentAnswer = answers[question.id];
        const result = this.gradeQuestion(question, studentAnswer);
        
        totalScore += result.pointsEarned;
        feedback.push({
          questionId: question.id,
          correct: result.correct,
          pointsEarned: result.pointsEarned,
          maxPoints: question.points,
          feedback: result.feedback
        });
      }

      const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

      logger.info(`Graded submission: ${totalScore}/${maxScore} (${percentage}%)`);

      return {
        score: totalScore,
        maxScore,
        percentage,
        feedback,
        passed: percentage >= (worksheet.passScore || 70)
      };
    } catch (error) {
      logger.error('Error grading submission:', error);
      throw error;
    }
  }

  /**
   * Grade a single question
   * @param {Object} question - Question object
   * @param {*} answer - Student's answer
   * @returns {Object} { correct, pointsEarned, feedback }
   */
  gradeQuestion(question, answer) {
    const type = question.type;
    
    switch (type) {
      case 'multiple-choice':
        return this.gradeMultipleChoice(question, answer);
      case 'checkbox':
        return this.gradeCheckbox(question, answer);
      case 'short-answer':
        return this.gradeShortAnswer(question, answer);
      case 'matching':
        return this.gradeMatching(question, answer);
      case 'ordering':
        return this.gradeOrdering(question, answer);
      default:
        logger.warn(`Unknown question type: ${type}`);
        return {
          correct: false,
          pointsEarned: 0,
          feedback: 'Unknown question type'
        };
    }
  }

  /**
   * Grade multiple choice question
   * Answer format: number (index of selected option)
   */
  gradeMultipleChoice(question, answer) {
    const isCorrect = answer === question.correctAnswer;
    
    return {
      correct: isCorrect,
      pointsEarned: isCorrect ? question.points : 0,
      feedback: isCorrect 
        ? 'Correct!' 
        : `Incorrect. Correct answer: ${question.options[question.correctAnswer]}`
    };
  }

  /**
   * Grade checkbox question (multiple answers)
   * Answer format: array of numbers (indices of selected options)
   */
  gradeCheckbox(question, answer) {
    if (!Array.isArray(answer)) {
      return {
        correct: false,
        pointsEarned: 0,
        feedback: 'Invalid answer format'
      };
    }

    const correctAnswers = question.correctAnswers || [];
    const sortedAnswer = [...answer].sort((a, b) => a - b);
    const sortedCorrect = [...correctAnswers].sort((a, b) => a - b);
    
    const isCorrect = JSON.stringify(sortedAnswer) === JSON.stringify(sortedCorrect);
    
    return {
      correct: isCorrect,
      pointsEarned: isCorrect ? question.points : 0,
      feedback: isCorrect
        ? 'Correct!'
        : 'Not all correct answers selected'
    };
  }

  /**
   * Grade short answer question
   * Answer format: string
   * 
   * NOTE: For complex short answers, this returns partial credit
   * and flags for manual review
   */
  gradeShortAnswer(question, answer) {
    if (typeof answer !== 'string') {
      return {
        correct: false,
        pointsEarned: 0,
        feedback: 'Invalid answer format',
        requiresManualReview: false
      };
    }

    let studentAnswer = answer.trim();
    let correctAnswer = question.correctAnswer.trim();

    // Apply case sensitivity
    if (!question.caseSensitive) {
      studentAnswer = studentAnswer.toLowerCase();
      correctAnswer = correctAnswer.toLowerCase();
    }

    const isExactMatch = studentAnswer === correctAnswer;

    if (isExactMatch) {
      return {
        correct: true,
        pointsEarned: question.points,
        feedback: 'Correct!',
        requiresManualReview: false
      };
    }

    // Check for close match (80% similarity)
    const similarity = this.calculateStringSimilarity(studentAnswer, correctAnswer);
    
    if (similarity >= 0.8) {
      // Award partial credit
      const partialPoints = Math.round(question.points * similarity);
      return {
        correct: false,
        pointsEarned: partialPoints,
        feedback: `Close answer. Awarded ${partialPoints}/${question.points} points.`,
        requiresManualReview: true
      };
    }

    // Completely wrong or requires manual review
    return {
      correct: false,
      pointsEarned: 0,
      feedback: 'Incorrect. Flagged for manual review.',
      requiresManualReview: true
    };
  }

  /**
   * Grade matching question
   * Answer format: object { leftItem: rightItem }
   */
  gradeMatching(question, answer) {
    if (!answer || typeof answer !== 'object') {
      return {
        correct: false,
        pointsEarned: 0,
        feedback: 'Invalid answer format'
      };
    }

    const correctPairs = question.pairs || [];
    let correctMatches = 0;

    for (const pair of correctPairs) {
      if (answer[pair.left] === pair.right) {
        correctMatches++;
      }
    }

    const totalPairs = correctPairs.length;
    const percentage = totalPairs > 0 ? correctMatches / totalPairs : 0;
    const pointsEarned = Math.round(question.points * percentage);
    const isFullyCorrect = correctMatches === totalPairs;

    return {
      correct: isFullyCorrect,
      pointsEarned,
      feedback: isFullyCorrect
        ? 'All matches correct!'
        : `${correctMatches}/${totalPairs} matches correct. Awarded ${pointsEarned}/${question.points} points.`
    };
  }

  /**
   * Grade ordering question
   * Answer format: array of numbers (indices in correct order)
   */
  gradeOrdering(question, answer) {
    if (!Array.isArray(answer)) {
      return {
        correct: false,
        pointsEarned: 0,
        feedback: 'Invalid answer format'
      };
    }

    const correctOrder = question.correctOrder || [];
    const isCorrect = JSON.stringify(answer) === JSON.stringify(correctOrder);

    if (isCorrect) {
      return {
        correct: true,
        pointsEarned: question.points,
        feedback: 'Correct order!'
      };
    }

    // Calculate partial credit based on correct adjacent pairs
    let correctPairs = 0;
    for (let i = 0; i < answer.length - 1; i++) {
      const currentIndex = correctOrder.indexOf(answer[i]);
      const nextIndex = correctOrder.indexOf(answer[i + 1]);
      if (currentIndex !== -1 && nextIndex !== -1 && nextIndex === currentIndex + 1) {
        correctPairs++;
      }
    }

    const maxPairs = answer.length - 1;
    const percentage = maxPairs > 0 ? correctPairs / maxPairs : 0;
    const pointsEarned = Math.round(question.points * percentage);

    return {
      correct: false,
      pointsEarned,
      feedback: `Partial credit: ${correctPairs}/${maxPairs} adjacent pairs correct. Awarded ${pointsEarned}/${question.points} points.`
    };
  }

  /**
   * Calculate similarity between two strings (Levenshtein distance)
   * Returns value between 0 and 1 (1 = identical)
   */
  calculateStringSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
      return 1.0;
    }

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Identify questions that require manual review
   * @param {Array} feedback - Feedback array from gradeSubmission
   * @returns {Array} Questions requiring review
   */
  getQuestionsForManualReview(feedback) {
    return feedback.filter(item => item.requiresManualReview === true);
  }
}

module.exports = new GradingService();
