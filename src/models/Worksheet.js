const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['multiple_choice', 'fill_blank', 'matching', 'true_false', 'short_answer'],
    required: true,
  },
  question: { type: String, required: true, trim: true },
  points: { type: Number, default: 10, min: 1 },
  explanation: { type: String, trim: true },

  // multiple_choice & true_false
  options: [{ type: String, trim: true }],
  correctAnswer: { type: String, trim: true },

  // matching
  pairs: [
    {
      left: { type: String, trim: true },
      right: { type: String, trim: true },
    },
  ],

  // short_answer
  sampleAnswer: { type: String, trim: true },
});

const worksheetSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    // Existing fields
    subject: { type: String, trim: true },
    gradeLevel: { type: String, trim: true },
    difficulty: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced'],
      default: 'beginner',
    },
    estimatedTime: { type: Number, default: 30 },
    autoGrade: { type: Boolean, default: true },
    passScore: { type: Number, default: 70 },

    // New fields for library search
    level: {
      type: String,
      enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', ''],
      default: '',
    },
    topic: { type: String, trim: true, default: '' },
    skill: {
      type: String,
      enum: ['grammar', 'vocabulary', 'reading', 'writing', 'listening', 'speaking', ''],
      default: '',
    },

    questions: [questionSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isPublished: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Indexes for search performance
worksheetSchema.index({ title: 'text', description: 'text', topic: 'text', subject: 'text' });
worksheetSchema.index({ level: 1 });
worksheetSchema.index({ skill: 1 });
worksheetSchema.index({ createdBy: 1 });
worksheetSchema.index({ isPublished: 1 });

module.exports = mongoose.model('Worksheet', worksheetSchema);
