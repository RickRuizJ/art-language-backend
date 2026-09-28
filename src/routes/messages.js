'use strict';

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const roleCheck = require('../middleware/roleCheck');
const messageController = require('../controllers/messageController');

router.use(auth);

router.get('/inbox', messageController.getInbox);
router.get('/sent', roleCheck('teacher', 'admin'), messageController.getSent);
router.post('/', roleCheck('teacher', 'admin'), messageController.sendMessage);
router.patch('/:id/read', messageController.markRead);

module.exports = router;
