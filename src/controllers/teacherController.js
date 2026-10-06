'use strict';
/**
 * controllers/teacherController.js
 *
 * BUGS FIXED:
 * 1. getMyStudents used:
 *      include: [{ model: User, as: 'students', ... }]
 *    This assumes Group.hasMany(User, { as: 'students' }) works via `group_id`
 *    on the users table. While the association exists, `group_id` on `users`
 *    is only populated when a student explicitly has a group set — in many
 *    setups students are added via the `group_members` junction table, not via
 *    `users.group_id`. Using only the direct FK misses those students.
 *
 *    FIX: Query via GroupMember (the junction table) which is the authoritative
 *    source of group membership. This matches how all other parts of the system
 *    (groups.js route, studentController) determine membership.
 *
 * 2. getStudentProfile used `Group` as a required include on `User` filtered
 *    by `teacherId`. If the student's `group_id` on the `users` table is null
 *    (because they joined via group_members instead), the query returns null
 *    even though the student IS in the teacher's group.
 *
 *    FIX: Verify membership via GroupMember separately, then load the profile.
 *
 * 3. Assignment ordering used `[['createdAt', 'DESC']]` — FIX: `created_at`.
 */

const { User, Group, Assignment, Worksheet, Submission, GroupMember } = require('../models');
const { Op } = require('sequelize');

/**
 * GET /api/teachers/students
 * Returns all groups belonging to this teacher, each with their members.
 */
const getMyStudents = async (req, res) => {
  try {
    const teacherId = req.user.id;

    // Load teacher's active groups with members via GroupMember junction
    const groups = await Group.findAll({
      where: { teacherId, isActive: true },
      attributes: ['id', 'name', 'subject', 'gradeLevel', 'joinCode'],
      include: [
        {
          model: GroupMember,
          as: 'members',
          include: [{
            model: User,
            as: 'student',
            attributes: ['id', 'firstName', 'lastName', 'email', 'avatarUrl']
          }]
        }
      ],
      order: [['name', 'ASC']]
    });

    // Flatten to a structure the frontend expects:
    // { groups: [{ id, name, students: [...] }] }
    const result = groups.map(g => ({
      id:          g.id,
      name:        g.name,
      subject:     g.subject,
      gradeLevel:  g.gradeLevel,
      joinCode:    g.joinCode,
      students:    (g.members || []).map(m => m.student).filter(Boolean)
    }));

    return res.status(200).json({ success: true, groups: result });
  } catch (err) {
    console.error('getMyStudents error:', err);
    return res.status(500).json({ success: false, message: 'Internal error', error: err.message });
  }
};

/**
 * GET /api/teachers/students/:studentId/profile
 * Full student profile with assignment progress.
 */
const getStudentProfile = async (req, res) => {
  try {
    const teacherId  = req.user.id;
    const { studentId } = req.params;

    // 1. Verify this student belongs to one of this teacher's groups
    const teacherGroupIds = (await Group.findAll({
      where: { teacherId },
      attributes: ['id']
    })).map(g => g.id);

    if (teacherGroupIds.length === 0) {
      return res.status(404).json({ success: false, message: 'No groups found for this teacher.' });
    }

    const membership = await GroupMember.findOne({
      where: {
        studentId,
        groupId: { [Op.in]: teacherGroupIds }
      },
      include: [{
        model: Group,
        as: 'group',
        attributes: ['id', 'name', 'subject']
      }]
    });

    if (!membership) {
      return res.status(404).json({ success: false, message: 'Student not found or not your student.' });
    }

    // 2. Load student base info
    const student = await User.findByPk(studentId, {
      attributes: ['id', 'firstName', 'lastName', 'email', 'avatarUrl', 'groupId', 'created_at']
    });

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const groupId = membership.groupId;

    // 3. Assignments for the group
    const assignments = await Assignment.findAll({
      where: { groupId, isActive: true },
      include: [
        { model: Worksheet, as: 'worksheet', attributes: ['id', 'title'] }
      ],
      order: [['created_at', 'DESC']]
    });

    // 4. Student submissions
    const submissions = await Submission.findAll({
      where: { studentId },
      attributes: ['id', 'worksheetId', 'status', 'score', 'maxScore', 'submittedAt', 'gradedAt'],
      order: [['submittedAt', 'DESC']]
    });

    const subMap = {};
    submissions.forEach(s => {
      const current = subMap[s.worksheetId];
      if (!current || new Date(s.submittedAt) > new Date(current.submittedAt)) subMap[s.worksheetId] = s;
    });

    const assignmentsWithStatus = assignments.map(a => ({
      ...a.toJSON(),
      submission:       subMap[a.worksheetId] || null,
      submissionStatus: subMap[a.worksheetId]?.status || 'pending'
    }));

    // 5. Compute progress by assignment, not by raw attempt count. Multiple
    // attempts for one worksheet must never make pendingAssignments negative.
    const assignedWorksheetIds = new Set(assignments.map(a => a.worksheetId));
    const latestAssignedSubs = Object.values(subMap).filter(s => assignedWorksheetIds.has(s.worksheetId));
    const completed = latestAssignedSubs.filter(s => ['submitted', 'graded', 'reviewed'].includes(s.status));
    const graded = latestAssignedSubs.filter(s => ['graded', 'reviewed'].includes(s.status) && s.score !== null);

    let avgScore = null;
    if (graded.length > 0) {
      const sum = graded.reduce((acc, s) => acc + (s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0), 0);
      avgScore = Math.round(sum / graded.length);
    }

    return res.status(200).json({
      success: true,
      student: {
        ...student.toJSON(),
        group: membership.group
      },
      progress: {
        totalAssignments:     assignments.length,
        completedAssignments: completed.length,
        pendingAssignments:   Math.max(0, assignments.length - completed.length),
        completionRate: assignments.length > 0
          ? Math.round((completed.length / assignments.length) * 100)
          : 0,
        avgScore
      },
      assignments:       assignmentsWithStatus,
      recentSubmissions: submissions.slice(0, 5)
    });
  } catch (err) {
    console.error('getStudentProfile error:', err);
    return res.status(500).json({ success: false, message: 'Internal error', error: err.message });
  }
};

module.exports = { getMyStudents, getStudentProfile };


/** GET /api/teachers/dashboard-stats */
const getDashboardStats = async (req, res) => {
  try {
    const groups = await Group.findAll({
      where: req.user.role === 'admin' ? {} : { teacherId: req.user.id },
      attributes: ['id'],
      include: [{ model: GroupMember, as: 'members', attributes: ['studentId'] }]
    });
    const studentIds = new Set();
    groups.forEach(g => g.members?.forEach(m => studentIds.add(m.studentId)));

    const worksheetWhere = req.user.role === 'admin' ? {} : { createdBy: req.user.id };
    const worksheets = await Worksheet.findAll({ where: worksheetWhere, attributes: ['id'] });
    const worksheetIds = worksheets.map(w => w.id);
    // Entregas que esperan al profesor ('submitted' o 'pending'), contando sólo el
    // intento vigente de cada alumno: uno antiguo reemplazado ya no necesita revisión.
    let pendingSubmissions = 0;
    if (worksheetIds.length) {
      const [rows] = await require('../config/database').query(
        `SELECT COUNT(*)::int AS count FROM submissions s
          WHERE s.status IN ('pending','submitted') AND s.worksheet_id IN (:ids)
            AND NOT EXISTS (SELECT 1 FROM submissions n
                             WHERE n.worksheet_id = s.worksheet_id AND n.student_id = s.student_id
                               AND n.attempt_number > s.attempt_number)`,
        { replacements: { ids: worksheetIds } }
      );
      pendingSubmissions = rows[0]?.count || 0;
    }

    return res.json({ success: true, data: {
      totalWorksheets: worksheets.length,
      totalGroups: groups.length,
      totalStudents: studentIds.size,
      pendingSubmissions
    }});
  } catch (err) {
    console.error('getDashboardStats error:', err);
    return res.status(500).json({ success: false, message: 'Could not load dashboard stats.' });
  }
};

module.exports.getDashboardStats = getDashboardStats;
