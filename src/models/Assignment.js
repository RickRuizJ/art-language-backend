const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  status: {
    type: String,
    enum: ['not_started', 'in_progress', 'submitted', 'graded'],
    default: 'submitted',
  },
  answers: { type: mongoose.Schema.Types.Mixed, default: [] },
  score: { type: Number, default: null },       // 0–100 percentage, null = not auto-gradeable
  feedback: { type: String },
  submittedAt: { type: Date },
  gradedAt: { type: Date },
  gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

const assignmentSchema = new mongoose.Schema(
  {
    worksheetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Worksheet',
      required: true,
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
      required: true,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    dueDate: { type: Date, default: null },
    instructions: { type: String, trim: true },
    submissions: [submissionSchema],
  },
  { timestamps: true }
);

// Indexes for fast lookups
assignmentSchema.index({ groupId: 1 });
assignmentSchema.index({ assignedBy: 1 });
assignmentSchema.index({ 'submissions.studentId': 1 });

module.exports = mongoose.model('Assignment', assignmentSchema);
