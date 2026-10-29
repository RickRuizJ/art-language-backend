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
    return res.status(500).json({ success: false, message: 'Internal error', code: 'TEACHER_DATA_UNAVAILABLE' });
  }
};

/**
 * GET /api/teachers/students/:studentId/profile
 * Full student profile with assignment progress.
 */
const getStudentProfile = async (req,res) => {
 try {
  const access=require('../services/access.service'),academic=require('../services/academic.service');
  const student=await access.studentAccess(req.user,req.params.studentId);
  if(!student)return res.status(404).json({success:false,message:'Student not found in your authorized scope.'});
  const ids=await access.groupIds(student.id,student.groupId);
  const groups=await Group.findAll({where:{id:{[Op.in]:ids},...access.groupScope(req.user)},attributes:['id','name']});
  const assignments=await Assignment.findAll({where:{groupId:{[Op.in]:groups.map(g=>g.id)},isActive:true},include:[{model:Worksheet,as:'worksheet',attributes:['id','title'],...(req.user.role==='admin'?{}:{where:{createdBy:req.user.id},required:true})}]});
  const history=await academic.history(student.id,req.user.role==='admin'?{}:{teacherId:req.user.id,groupIds:groups.map(g=>g.id)});
  const submissions=await Submission.findAll({where:{studentId:student.id},include:[{model:Worksheet,as:'worksheet',attributes:['id','title'],...(req.user.role==='admin'?{}:{where:{createdBy:req.user.id},required:true})}],order:[['attemptNumber','DESC'],['submittedAt','DESC']]});
  const stats=academic.automaticStats(assignments,submissions);
  return res.json({success:true,student:{id:student.id,firstName:student.firstName,lastName:student.lastName,email:student.email,isActive:student.isActive,created_at:student.created_at,groups},progress:{totalAssignments:stats.total,completedAssignments:stats.completed,pendingAssignments:stats.pending,avgScore:stats.avgScore,completionRate:stats.total?Math.round(stats.completed*100/stats.total):0},assignments,recentSubmissions:history.automatic.slice(0,5),academicHistory:history});
 } catch {return res.status(503).json({success:false,message:'Could not load authorized student profile.'});}
};

module.exports = { getMyStudents, getStudentProfile };


/** GET /api/teachers/dashboard-stats */
const getDashboardStats = async (req, res) => {
  try {
    const groups = await Group.findAll({
      where: { ...(req.user.role === 'admin' ? {} : { teacherId: req.user.id }), isActive: {[Op.not]:false} },
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
