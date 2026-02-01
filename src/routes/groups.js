const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const { Group, GroupMember } = require('../models/Group');
const User = require('../models/User');

// All routes require authentication
router.use(auth);

// Get all groups
router.get('/', async (req, res) => {
  try {
    const where = {};
    
    if (req.user.role === 'teacher') {
      where.teacherId = req.user.id;
    }

    const groups = await Group.findAll({
      where,
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

    res.json({ success: true, data: { groups } });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create group (Teacher, Admin only)
router.post('/', roleCheck('teacher', 'admin'), async (req, res) => {
  try {
    const group = await Group.create({
      ...req.body,
      teacherId: req.user.id
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

// Add students to group
router.post('/:id/students', roleCheck('teacher', 'admin'), async (req, res) => {
  try {
    const { studentIds } = req.body;
    const group = await Group.findByPk(req.params.id);

    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    if (group.teacherId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const members = await Promise.all(
      studentIds.map(studentId => 
        GroupMember.create({
          groupId: group.id,
          studentId
        }).catch(err => null) // Ignore duplicates
      )
    );

    res.json({
      success: true,
      message: 'Students added to group',
      data: { members: members.filter(m => m !== null) }
    });
  } catch (error) {
    console.error('Add students error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Remove student from group
router.delete('/:groupId/students/:studentId', roleCheck('teacher', 'admin'), async (req, res) => {
  try {
    const { groupId, studentId } = req.params;
    const group = await Group.findByPk(groupId);

    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    if (group.teacherId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await GroupMember.destroy({
      where: { groupId, studentId }
    });

    res.json({
      success: true,
      message: 'Student removed from group'
    });
  } catch (error) {
    console.error('Remove student error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Delete group
router.delete('/:id', roleCheck('teacher', 'admin'), async (req, res) => {
  try {
    const group = await Group.findByPk(req.params.id);

    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    if (group.teacherId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await group.destroy();

    res.json({
      success: true,
      message: 'Group deleted successfully'
    });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
