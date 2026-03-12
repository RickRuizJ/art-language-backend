const Assignment = require('../models/Assignment');
const Group = require('../models/Group');

/**
 * GET /students/:studentId/progress
 * Returns progress stats: completedWorksheets, averageScore, streak, recentActivity.
 */
const getStudentProgress = async (req, res) => {
  try {
    const { studentId } = req.params;

    if (req.user.role === 'student' && req.user.id !== studentId) {
      return res.status(403).json({ status: 'error', message: 'Access denied.' });
    }

    // All assignments where this student submitted
    const assignments = await Assignment.find({
      'submissions.studentId': studentId,
    })
      .populate('worksheetId', 'title level subject')
      .lean();

    // Extract this student's submissions
    const submissions = [];
    for (const a of assignments) {
      const sub = (a.submissions || []).find(s => s.studentId?.toString() === studentId);
      if (sub) {
        submissions.push({
          assignmentId: a._id,
          worksheetTitle: a.worksheetId?.title,
          worksheetLevel: a.worksheetId?.level,
          status: sub.status,
          score: sub.score,
          submittedAt: sub.submittedAt,
        });
      }
    }

    const completed = submissions.filter(s => s.status === 'submitted' || s.status === 'graded');
    const scored = completed.filter(s => s.score !== null && s.score !== undefined);
    const averageScore = scored.length > 0
      ? Math.round(scored.reduce((acc, s) => acc + s.score, 0) / scored.length)
      : null;

    const streak = computeStreak(submissions);

    const recentActivity = [...submissions]
      .filter(s => s.submittedAt)
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
      .slice(0, 10);

    res.status(200).json({
      status: 'success',
      data: {
        completedWorksheets: completed.length,
        totalAssignments: submissions.length,
        averageScore,
        streak,
        recentActivity,
      },
    });
  } catch (err) {
    console.error('getStudentProgress error:', err);
    res.status(500).json({ status: 'error', message: 'Server error retrieving progress.' });
  }
};

/**
 * Helper: count consecutive days of activity ending today/yesterday.
 */
function computeStreak(submissions) {
  if (!submissions.length) return 0;

  const activeDays = new Set(
    submissions
      .filter(s => s.submittedAt)
      .map(s => new Date(s.submittedAt).toISOString().split('T')[0])
  );

  if (activeDays.size === 0) return 0;

  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const cursor = new Date(today);
  // Allow streak to include yesterday if nothing today yet
  const todayKey = today.toISOString().split('T')[0];
  if (!activeDays.has(todayKey)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (true) {
    const key = cursor.toISOString().split('T')[0];
    if (activeDays.has(key)) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

module.exports = { getStudentProgress };
