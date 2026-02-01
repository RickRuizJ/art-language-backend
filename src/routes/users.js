const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const User = require('../models/User');

// All routes require authentication
router.use(auth);

// Get all users (Admin only)
router.get('/', roleCheck('admin', 'teacher'), async (req, res) => {
  try {
    const { role } = req.query;
    const where = {};
    
    if (role) where.role = role;
    if (req.user.role === 'teacher') where.role = 'student';

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
