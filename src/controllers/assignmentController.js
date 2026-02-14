const { Assignment, Worksheet, Group, User, GroupMember } = require('../models');

// @route   POST /api/groups/:groupId/assignments
// @desc    Assign worksheet to group
// @access  Private (Teacher, Admin)
exports.assignWorksheet = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { worksheetId, dueDate, instructions } = req.body;

    // Validate input
    if (!worksheetId) {
      return res.status(400).json({
        success: false,
        message: 'Worksheet ID is required'
      });
    }

    // Verify group exists
    const group = await Group.findByPk(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Verify ownership
    if (group.teacherId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only assign worksheets to your own groups'
      });
    }

    // Verify worksheet exists
    const worksheet = await Worksheet.findByPk(worksheetId);
    if (!worksheet) {
      return res.status(404).json({
        success: false,
        message: 'Worksheet not found'
      });
    }

    // Check if already assigned
    const existing = await Assignment.findOne({
      where: { 
        worksheetId, 
        groupId,
        isActive: true 
      }
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'This worksheet is already assigned to this group'
      });
    }

    // Create assignment
    const assignment = await Assignment.create({
      worksheetId,
      groupId,
      assignedBy: req.user.id,
      dueDate: dueDate || null,
      instructions: instructions || null
    });

    // Return full assignment with worksheet details
    const fullAssignment = await Assignment.findByPk(assignment.id, {
      include: [{
        model: Worksheet,
        as: 'worksheet',
        attributes: ['id', 'title', 'description', 'subject', 'gradeLevel', 'difficulty', 'estimatedTime']
      }]
    });

    res.status(201).json({
      success: true,
      message: 'Worksheet assigned successfully',
      data: { assignment: fullAssignment }
    });
  } catch (error) {
    console.error('Assign worksheet error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign worksheet',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @route   GET /api/groups/:groupId/assignments
// @desc    Get all assignments for a group
// @access  Private
exports.getGroupAssignments = async (req, res) => {
  try {
    const { groupId } = req.params;

    // Verify group exists
    const group = await Group.findByPk(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Permission check
    if (req.user.role === 'teacher') {
      if (group.teacherId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    } else if (req.user.role === 'student') {
      const isMember = await GroupMember.findOne({
        where: { 
          groupId, 
          studentId: req.user.id 
        }
      });
      
      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: 'You are not a member of this group'
        });
      }
    }

    // Get assignments
    const assignments = await Assignment.findAll({
      where: { 
        groupId, 
        isActive: true 
      },
      include: [{
        model: Worksheet,
        as: 'worksheet',
        include: [{
          model: User,
          as: 'creator',
          attributes: ['id', 'firstName', 'lastName']
        }]
      }],
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: { assignments }
    });
  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load assignments'
    });
  }
};

// @route   DELETE /api/groups/:groupId/assignments/:assignmentId
// @desc    Remove assignment
// @access  Private (Teacher, Admin)
exports.removeAssignment = async (req, res) => {
  try {
    const { groupId, assignmentId } = req.params;

    const assignment = await Assignment.findOne({
      where: { 
        id: assignmentId, 
        groupId 
      }
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found'
      });
    }

    // Verify ownership
    const group = await Group.findByPk(groupId);
    if (group.teacherId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Soft delete
    await assignment.update({ isActive: false });
    // OR hard delete:
    // await assignment.destroy();

    res.json({
      success: true,
      message: 'Assignment removed successfully'
    });
  } catch (error) {
    console.error('Remove assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove assignment'
    });
  }
};
