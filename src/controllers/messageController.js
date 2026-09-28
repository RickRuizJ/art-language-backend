'use strict';

const { Message, User, Group, GroupMember } = require('../models');
const logger = require('../config/logger');

async function resolveTeacherMembership(teacherId, recipientId, requestedGroupId) {
  if (requestedGroupId) {
    const group = await Group.findOne({
      where: { id: requestedGroupId, teacherId, isActive: true },
      attributes: ['id']
    });
    if (!group) return null;

    const membership = await GroupMember.findOne({
      where: { groupId: requestedGroupId, studentId: recipientId },
      attributes: ['groupId', 'studentId']
    });
    return membership || null;
  }

  return GroupMember.findOne({
    where: { studentId: recipientId },
    include: [{
      model: Group,
      as: 'group',
      where: { teacherId, isActive: true },
      attributes: ['id']
    }]
  });
}

exports.sendMessage = async (req, res) => {
  try {
    const { recipientId, groupId, subject, body } = req.body;

    if (!recipientId) {
      return res.status(400).json({ success: false, message: 'recipientId is required.' });
    }
    if (!body || !body.trim()) {
      return res.status(400).json({ success: false, message: 'Message body is required.' });
    }
    if (body.trim().length > 5000) {
      return res.status(400).json({ success: false, message: 'Message is too long (max 5000 characters).' });
    }

    const recipient = await User.findOne({
      where: { id: recipientId, role: 'student', isActive: true },
      attributes: ['id', 'firstName', 'lastName', 'email']
    });
    if (!recipient) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    let resolvedGroupId = groupId || null;

    if (req.user.role === 'teacher') {
      const membership = await resolveTeacherMembership(req.user.id, recipientId, groupId);
      if (!membership) {
        return res.status(403).json({
          success: false,
          message: 'You can only message students who belong to one of your groups.'
        });
      }
      resolvedGroupId = membership.groupId || membership.group?.id || resolvedGroupId;
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only teachers and admins can send messages.' });
    }

    const message = await Message.create({
      senderId: req.user.id,
      recipientId,
      groupId: resolvedGroupId,
      subject: subject?.trim() || null,
      body: body.trim()
    });

    const populated = await Message.findByPk(message.id, {
      include: [
        { model: User, as: 'sender', attributes: ['id', 'firstName', 'lastName'] },
        { model: User, as: 'recipient', attributes: ['id', 'firstName', 'lastName'] },
        { model: Group, as: 'group', attributes: ['id', 'name'], required: false }
      ]
    });

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully.',
      data: { message: populated }
    });
  } catch (error) {
    logger.error('sendMessage error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
};

exports.getInbox = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '30', 10), 1), 100);

    const messages = await Message.findAll({
      where: { recipientId: req.user.id },
      include: [
        { model: User, as: 'sender', attributes: ['id', 'firstName', 'lastName', 'avatarUrl'] },
        { model: Group, as: 'group', attributes: ['id', 'name'], required: false }
      ],
      order: [['created_at', 'DESC']],
      limit
    });

    const unreadCount = await Message.count({
      where: { recipientId: req.user.id, isRead: false }
    });

    return res.json({ success: true, data: { messages, unreadCount } });
  } catch (error) {
    logger.error('getInbox error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load messages.' });
  }
};

exports.getSent = async (req, res) => {
  try {
    if (!['teacher', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const where = { senderId: req.user.id };
    if (req.query.recipientId) where.recipientId = req.query.recipientId;

    const messages = await Message.findAll({
      where,
      include: [
        { model: User, as: 'recipient', attributes: ['id', 'firstName', 'lastName'] },
        { model: Group, as: 'group', attributes: ['id', 'name'], required: false }
      ],
      order: [['created_at', 'DESC']],
      limit: 100
    });

    return res.json({ success: true, data: { messages } });
  } catch (error) {
    logger.error('getSent error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load sent messages.' });
  }
};

exports.markRead = async (req, res) => {
  try {
    const message = await Message.findOne({
      where: { id: req.params.id, recipientId: req.user.id }
    });

    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found.' });
    }

    if (!message.isRead) {
      message.isRead = true;
      message.readAt = new Date();
      await message.save();
    }

    return res.json({ success: true, data: { message } });
  } catch (error) {
    logger.error('markRead error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update message.' });
  }
};
