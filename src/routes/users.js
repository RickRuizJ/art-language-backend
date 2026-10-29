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
    const where = req.user.role === 'teacher' ? await require('../services/access.service').rosterWhere(req.user) : (req.query.role ? {role:req.query.role} : {});

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
