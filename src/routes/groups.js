const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const { Group, GroupMember, User } = require('../models');
const { Op } = require('sequelize');
const {generateJoinCode}=require('../utils/groupCodes');
const access = require('../services/access.service');
const { record } = require('../services/audit.service');

// All routes require authentication
router.use(auth);

// Get all groups
// FIXED: Students see only their groups, teachers see their created groups
router.get('/', async (req, res) => {
  try {
    let groups;
    const activeFilter=req.user.role!=='student'&&req.query.includeArchived==='true'?{}:{isActive:{[Op.not]:false}};

    if (req.user.role === 'student') {
      // Students: get groups they're members of
      const memberships = await GroupMember.findAll({
        where: { studentId: req.user.id },
        attributes: ['groupId']
      });

      const groupIds = memberships.map(m => m.groupId);

      if (groupIds.length === 0) {
        return res.json({ success: true, data: { groups: [] } });
      }

      groups = await Group.findAll({
        where: { id: { [Op.in]: groupIds }, ...activeFilter },
        include: [
          {
            model: User,
            as: 'teacher',
            attributes: ['id', 'firstName', 'lastName', 'email']
          },
          {
            model: GroupMember,
            as: 'members',
            include: [{
              model: User,
              as: 'student',
              attributes: ['id', 'firstName', 'lastName', 'email']
            }]
          }
        ],
        order: [['created_at', 'DESC']]
      });
    } else if (req.user.role === 'teacher') {
      // Teachers: get groups they created
      groups = await Group.findAll({
        where: { teacherId: req.user.id, ...activeFilter },
        include: [
          {
            model: User,
            as: 'teacher',
            attributes: ['id', 'firstName', 'lastName', 'email']
          },
          {
            model: GroupMember,
            as: 'members',
            include: [{
              model: User,
              as: 'student',
              attributes: ['id', 'firstName', 'lastName', 'email']
            }]
          }
        ],
        order: [['created_at', 'DESC']]
      });
    } else {
      // Admin: see all groups
      groups = await Group.findAll({
        where: activeFilter,
        include: [
          {
            model: User,
            as: 'teacher',
            attributes: ['id', 'firstName', 'lastName', 'email']
          },
          {
            model: GroupMember,
            as: 'members',
            include: [{
              model: User,
              as: 'student',
              attributes: ['id', 'firstName', 'lastName', 'email']
            }]
          }
        ],
        order: [['created_at', 'DESC']]
      });
    }

    res.json({ success: true, data: { groups } });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get available students (for teachers adding to groups)
router.get('/available-students', roleCheck('teacher', 'admin'), async (req, res) => {
  try {
    const students = await User.findAll({where:await access.rosterWhere(req.user),attributes:['id','firstName','lastName','email'],order:[['firstName','ASC'],['lastName','ASC']]});

    res.json({ success: true, data: { students } });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Join group with code (students)
router.post('/join', roleCheck('student'), async (req, res) => {
  try {
    const { joinCode } = req.body;

    if (!joinCode) {
      return res.status(400).json({ success: false, message: 'Join code is required' });
    }

    // Find group by join code
    const group = await Group.findOne({
      where: { joinCode: typeof joinCode === 'string' ? joinCode.trim().toUpperCase() : '', isActive: true }
    });

    if (!group) {
      return res.status(404).json({ success: false, message: 'Invalid join code' });
    }

    // Check if already a member
    const existing = await GroupMember.findOne({
      where: {
        groupId: group.id,
        studentId: req.user.id
      }
    });

    if (existing) {
      return res.status(400).json({ success: false, message: 'You are already a member of this group' });
    }

    // Add student to group
    await GroupMember.create({
      groupId: group.id,
      studentId: req.user.id
    });

    // Return group info
    const updatedGroup = await Group.findByPk(group.id, {
      include: [
        {
          model: User,
          as: 'teacher',
          attributes: ['id', 'firstName', 'lastName', 'email']
        }
      ]
    });

    res.json({
      success: true,
      message: `Successfully joined "${updatedGroup.name}"`,
      data: { group: updatedGroup }
    });
  } catch (error) {
    console.error('Join group error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create group (teachers only)
router.post('/', roleCheck('teacher', 'admin'), async (req, res) => {
  try {
    const { name, description } = req.body;

    // Generate unique join code
    const joinCode = await generateUniqueJoinCode();

    const group = await Group.create({
      name,
      description,
      teacherId: req.user.id,
      joinCode
    });

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      data: { group }
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Regenerate a group code without affecting existing group membership.
router.post('/:id/registration-code/rotate', roleCheck('teacher', 'admin'), async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);
    if (!group || (req.user.role !== 'admin' && group.teacherId !== req.user.id)) return res.status(404).json({ success: false, message: 'Group not found.' });
    group.joinCode = await generateUniqueJoinCode();
    await group.save();
    await record(req.user.id,'group.code_rotated',group.id,{});
    res.json({ success: true, data: { joinCode: group.joinCode } });
  } catch (error) { console.error('Rotate registration code:', error); res.status(500).json({ success: false, message: 'Could not rotate group code.' }); }
});

// Get single group
router.get('/:id', async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'teacher',
          attributes: ['id', 'firstName', 'lastName', 'email']
        },
        {
          model: GroupMember,
          as: 'members',
          include: [{
            model: User,
            as: 'student',
            attributes: ['id', 'firstName', 'lastName', 'email']
          }]
        }
      ]
    });

    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    // Permission check
    if (req.user.role === 'teacher' && group.teacherId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (req.user.role === 'student') {
      const isMember = group.members.some(m => m.studentId === req.user.id);
      if (!isMember) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    res.json({ success: true, data: { group } });
  } catch (error) {
    console.error('Get group error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Add students to group (teachers only)
router.post('/:id/students', roleCheck('teacher','admin'), async (req,res) => {
 try { await access.addMembers(req.user,req.params.id,req.body.studentIds); res.json({success:true,message:'Students added.'}); }
 catch(e){res.status(e.status||500).json({success:false,message:e.status?e.message:'Could not add students.'});}
});
router.delete('/:groupId/students/:studentId', roleCheck('teacher','admin'), async(req,res)=>{
 try {await access.removeMember(req.user,req.params.groupId,req.params.studentId);res.json({success:true,message:'Student removed; academic history preserved.'});}
 catch(e){res.status(e.status||500).json({success:false,message:e.status?e.message:'Could not remove student.'});}
});

// Delete group (teachers only)
router.delete('/:id', roleCheck('teacher', 'admin'), async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);

    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    // Check ownership
    if (req.user.role === 'teacher' && group.teacherId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await require('../config/database').transaction(async transaction=>{
      await group.update({isActive:false},{transaction});
      await require('../models').Assignment.update({isActive:false},{where:{groupId:group.id},transaction});
      await record(req.user.id,'group.archived',group.id,{},transaction);
    });

    res.json({ success: true, message: 'Group deleted successfully' });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Helper: Generate unique join code
async function generateUniqueJoinCode() {
  let code;
  let exists = true;

  while (exists) {
    code = generateJoinCode();

    const existing = await Group.findOne({ where: { joinCode: code } });
    exists = !!existing;
  }

  return code;
}


// ─── Assignment Routes ────────────────────────────────────────────────────────
const assignmentController = require('../controllers/assignmentController');

// Assign worksheet to group
router.post('/:groupId/assignments', 
  roleCheck('teacher', 'admin'),
  assignmentController.assignWorksheet
);

// Get group assignments
router.get('/:groupId/assignments',
  assignmentController.getGroupAssignments
);

// Remove assignment
router.delete('/:groupId/assignments/:assignmentId',
  roleCheck('teacher', 'admin'),
  assignmentController.removeAssignment
);

// ──────────────────────────────────────────────────────────────────────────────

module.exports = router;
