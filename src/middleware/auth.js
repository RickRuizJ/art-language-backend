/**
 * middleware/auth.js
 *
 * BUGS FIXED:
 * 1. teacherRoutes.js and studentRoutes.js import { authenticate } — but the
 *    original file only exported the default function. This caused:
 *      TypeError: authenticate is not a function → 500 on every protected route.
 *
 * 2. assignmentRoutes.js imported { protect } — same crash.
 *
 * FIX: Export the middleware as the default export AND as named aliases
 *      `authenticate` and `protect` so every existing import style works.
 */

const jwt = require('jsonwebtoken');
const { User } = require('../models');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findByPk(decoded.id);

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token or user not active.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired.'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error during authentication.'
    });
  }
};

// Named aliases used by different route files
module.exports = auth;
module.exports.authenticate = auth;  // used by teacherRoutes.js / studentRoutes.js
module.exports.protect      = auth;  // used by assignmentRoutes.js / worksheetRoutes.js
