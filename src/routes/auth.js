const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/auth');

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Protected routes
router.get('/me', auth, authController.getMe);
router.post('/refresh', auth, authController.refreshToken);
router.post('/assistant-access',auth,require('../middleware/roleCheck')('student'),require('../middleware/securityLimits').limit('assistant-user',{max:20,windowMs:600000,key:req=>req.user.id}),(req,res)=>res.json({success:true,data:{user:{id:req.user.id,role:req.user.role}}}));
router.post('/change-password', auth, authController.changePassword);

module.exports = router;
