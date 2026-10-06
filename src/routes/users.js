const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const { Op } = require('sequelize');
const { User, Group, GroupMember } = require('../models');

// All routes require authentication
router.use(auth);

// Get all users (Admin only)
router.get('/', roleCheck('admin', 'teacher'), async (req, res) => {
  try {
    const { role } = req.query;
    const where = {};
    
    if (role) where.role = role;
    if (req.user.role === 'teacher') {
      where.role = 'student';
      const groups = await Group.findAll({ where: { teacherId: req.user.id }, attributes: ['id'] });
      const memberships = await GroupMember.findAll({
        where: { groupId: { [Op.in]: groups.map(g => g.id) } },
        attributes: ['studentId']
      });
      where.id = { [Op.in]: memberships.map(m => m.studentId) };
    }

    const users = await User.findAll({
      where,
      attributes: { exclude: ['password'] },
      order: [['created_at', 'DESC']]
    });

    res.json({ success: true, data: { users } });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
