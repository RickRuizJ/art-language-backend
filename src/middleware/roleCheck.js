/**
 * middleware/roleCheck.js
 *
 * BUGS FIXED:
 * teacherRoutes.js and studentRoutes.js import { requireRole } — but the
 * original file only exported the default function under the name `roleCheck`.
 * This caused TypeError: requireRole is not a function on every teacher/student route.
 *
 * FIX: Export as default AND as named alias `requireRole`.
 */

const roleCheck = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
    }

    next();
  };
};

module.exports = roleCheck;
module.exports.requireRole = roleCheck; // used by teacherRoutes.js / studentRoutes.js
