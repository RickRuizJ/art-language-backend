const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const { Group, GroupMember, User } = require('../models');
const { Op } = require('sequelize');

// All routes require authentication
router.use(auth);

// Get all groups
// FIXED: Students see only their groups, teachers see their created groups
router.get('/', async (req, res) => {
  try {
    let groups;

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
        where: { id: { [Op.in]: groupIds } },
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
        where: { teacherId: req.user.id },
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
    const students = await User.findAll({
      where: { role: 'student' },
      attributes: ['id', 'firstName', 'lastName', 'email'],
      order: [['firstName', 'ASC'], ['lastName', 'ASC']]
    });

    res.json({ success: true, data: { students } });
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Join group with code (students)
router.post('/join', async (req, res) => {
  try {
    const { joinCode } = req.body;

    if (!joinCode) {
      return res.status(400).json({ success: false, message: 'Join code is required' });
    }

    // Find group by join code
    const group = await Group.findOne({
      where: { joinCode: joinCode.toUpperCase() }
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
      studentId: req.user.id,
      role: 'member'
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
router.post('/:id/students', roleCheck('teacher', 'admin'), async (req, res) => {
  try {
    const { studentIds } = req.body;

    const group = await Group.findByPk(req.params.id);
    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    // Check ownership
    if (req.user.role === 'teacher' && group.teacherId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Add students (ignore if already members)
    const memberships = studentIds.map(studentId => ({
      groupId: group.id,
      studentId,
      role: 'member'
    }));

    await GroupMember.bulkCreate(memberships, {
      ignoreDuplicates: true
    });

    res.json({ success: true, message: 'Students added successfully' });
  } catch (error) {
    console.error('Add students error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Remove student from group (teachers only)
router.delete('/:groupId/students/:studentId', roleCheck('teacher', 'admin'), async (req, res) => {
  try {
    const { groupId, studentId } = req.params;

    const group = await Group.findByPk(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    // Check ownership
    if (req.user.role === 'teacher' && group.teacherId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await GroupMember.destroy({
      where: { groupId, studentId }
    });

    res.json({ success: true, message: 'Student removed successfully' });
  } catch (error) {
    console.error('Remove student error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
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

    await group.destroy();

    res.json({ success: true, message: 'Group deleted successfully' });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Helper: Generate unique join code
async function generateUniqueJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  let exists = true;

  while (exists) {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    const existing = await Group.findOne({ where: { joinCode: code } });
    exists = !!existing;
  }

  return code;
}

module.exports = router;
