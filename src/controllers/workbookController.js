const { Workbook, WorkbookWorksheet } = require('../models/Workbook');
const Worksheet = require('../models/Worksheet');
const User = require('../models/User');
const sequelize = require('../config/database');

/**
 * Get all workbooks
 * Teachers see only their workbooks
 * Students see published workbooks
 */
exports.getAllWorkbooks = async (req, res) => {
  try {
    const { status, subject, gradeLevel } = req.query;
    const where = { isActive: true };

    // Filter by user role
    if (req.user.role === 'teacher') {
      where.createdBy = req.user.id;
    } else if (req.user.role === 'student') {
      where.status = 'published';
    }

    // Additional filters
    if (status) where.status = status;
    if (subject) where.subject = subject;
    if (gradeLevel) where.gradeLevel = gradeLevel;

    const workbooks = await Workbook.findAll({
      where,
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'firstName', 'lastName', 'email']
        },
        {
          model: Worksheet,
          as: 'worksheets',
          through: {
            attributes: ['displayOrder'],
            as: 'worksheetOrder'
          },
          attributes: ['id', 'title', 'description', 'difficulty', 'estimatedTime', 'isPublished']
        }
      ],
      order: [
        ['displayOrder', 'ASC'],
        ['createdAt', 'DESC'],
        [{ model: Worksheet, as: 'worksheets' }, WorkbookWorksheet, 'displayOrder', 'ASC']
      ]
    });

    res.json({
      success: true,
      data: { workbooks, count: workbooks.length }
    });
  } catch (error) {
    console.error('Get workbooks error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch workbooks'
    });
  }
};

/**
 * Get single workbook by ID
 */
exports.getWorkbookById = async (req, res) => {
  try {
    const workbook = await Workbook.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'author',
          attributes: ['id', 'firstName', 'lastName', 'email', 'avatarUrl']
        },
        {
          model: Worksheet,
          as: 'worksheets',
          through: {
            attributes: ['displayOrder', 'addedAt'],
            as: 'worksheetOrder'
          }
        }
      ],
      order: [
        [{ model: Worksheet, as: 'worksheets' }, WorkbookWorksheet, 'displayOrder', 'ASC']
      ]
    });

    if (!workbook) {
      return res.status(404).json({
        success: false,
        message: 'Workbook not found'
      });
    }

    // Check permissions
    if (
      workbook.status === 'draft' &&
      req.user.role === 'student'
    ) {
      return res.status(403).json({
        success: false,
        message: 'This workbook is not published yet'
      });
    }

    if (
      req.user.role === 'teacher' &&
      workbook.createdBy !== req.user.id &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: { workbook }
    });
  } catch (error) {
    console.error('Get workbook error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch workbook'
    });
  }
};

/**
 * Create new workbook
 */
exports.createWorkbook = async (req, res) => {
  try {
    const {
      title,
      description,
      coverImageUrl,
      subject,
      gradeLevel,
      status
    } = req.body;

    const workbook = await Workbook.create({
      title,
      description,
      coverImageUrl,
      subject,
      gradeLevel,
      status: status || 'draft',
      createdBy: req.user.id
    });

    // Fetch with author info
    const createdWorkbook = await Workbook.findByPk(workbook.id, {
      include: [{
        model: User,
        as: 'author',
        attributes: ['id', 'firstName', 'lastName', 'email']
      }]
    });

    res.status(201).json({
      success: true,
      message: 'Workbook created successfully',
      data: { workbook: createdWorkbook }
    });
  } catch (error) {
    console.error('Create workbook error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create workbook'
    });
  }
};

/**
 * Update workbook
 */
exports.updateWorkbook = async (req, res) => {
  try {
    const workbook = await Workbook.findByPk(req.params.id);

    if (!workbook) {
      return res.status(404).json({
        success: false,
        message: 'Workbook not found'
      });
    }

    // Check permissions
    if (workbook.createdBy !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const {
      title,
      description,
      coverImageUrl,
      subject,
      gradeLevel,
      status,
      displayOrder
    } = req.body;

    await workbook.update({
      title,
      description,
      coverImageUrl,
      subject,
      gradeLevel,
      status,
      displayOrder
    });

    const updatedWorkbook = await Workbook.findByPk(workbook.id, {
      include: [{
        model: User,
        as: 'author',
        attributes: ['id', 'firstName', 'lastName', 'email']
      }]
    });

    res.json({
      success: true,
      message: 'Workbook updated successfully',
      data: { workbook: updatedWorkbook }
    });
  } catch (error) {
    console.error('Update workbook error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update workbook'
    });
  }
};

/**
 * Delete workbook
 */
exports.deleteWorkbook = async (req, res) => {
  try {
    const workbook = await Workbook.findByPk(req.params.id);

    if (!workbook) {
      return res.status(404).json({
        success: false,
        message: 'Workbook not found'
      });
    }

    // Check permissions
    if (workbook.createdBy !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    await workbook.destroy();

    res.json({
      success: true,
      message: 'Workbook deleted successfully'
    });
  } catch (error) {
    console.error('Delete workbook error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete workbook'
    });
  }
};

/**
 * Add worksheet to workbook
 */
exports.addWorksheetToWorkbook = async (req, res) => {
  try {
    const { workbookId, worksheetId } = req.params;
    const { displayOrder } = req.body;

    const workbook = await Workbook.findByPk(workbookId);
    if (!workbook) {
      return res.status(404).json({
        success: false,
        message: 'Workbook not found'
      });
    }

    // Check permissions
    if (workbook.createdBy !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const worksheet = await Worksheet.findByPk(worksheetId);
    if (!worksheet) {
      return res.status(404).json({
        success: false,
        message: 'Worksheet not found'
      });
    }

    // Get current max order
    const maxOrder = await WorkbookWorksheet.max('displayOrder', {
      where: { workbookId }
    });

    const workbookWorksheet = await WorkbookWorksheet.create({
      workbookId,
      worksheetId,
      displayOrder: displayOrder !== undefined ? displayOrder : (maxOrder || 0) + 1
    });

    res.status(201).json({
      success: true,
      message: 'Worksheet added to workbook',
      data: { workbookWorksheet }
    });
  } catch (error) {
    console.error('Add worksheet error:', error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        message: 'This worksheet is already in the workbook'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to add worksheet to workbook'
    });
  }
};

/**
 * Remove worksheet from workbook
 */
exports.removeWorksheetFromWorkbook = async (req, res) => {
  try {
    const { workbookId, worksheetId } = req.params;

    const workbook = await Workbook.findByPk(workbookId);
    if (!workbook) {
      return res.status(404).json({
        success: false,
        message: 'Workbook not found'
      });
    }

    // Check permissions
    if (workbook.createdBy !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    await WorkbookWorksheet.destroy({
      where: { workbookId, worksheetId }
    });

    res.json({
      success: true,
      message: 'Worksheet removed from workbook'
    });
  } catch (error) {
    console.error('Remove worksheet error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove worksheet'
    });
  }
};

/**
 * Reorder worksheets in workbook
 */
exports.reorderWorksheets = async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    const { workbookId } = req.params;
    const { worksheetOrders } = req.body; // Array of { worksheetId, displayOrder }

    const workbook = await Workbook.findByPk(workbookId);
    if (!workbook) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: 'Workbook not found'
      });
    }

    // Check permissions
    if (workbook.createdBy !== req.user.id && req.user.role !== 'admin') {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update all orders
    for (const item of worksheetOrders) {
      await WorkbookWorksheet.update(
        { displayOrder: item.displayOrder },
        {
          where: {
            workbookId,
            worksheetId: item.worksheetId
          },
          transaction
        }
      );
    }

    await transaction.commit();

    res.json({
      success: true,
      message: 'Worksheets reordered successfully'
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Reorder worksheets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reorder worksheets'
    });
  }
};

/**
 * Toggle workbook publish status
 */
exports.togglePublish = async (req, res) => {
  try {
    const workbook = await Workbook.findByPk(req.params.id);

    if (!workbook) {
      return res.status(404).json({
        success: false,
        message: 'Workbook not found'
      });
    }

    // Check permissions
    if (workbook.createdBy !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const newStatus = workbook.status === 'published' ? 'draft' : 'published';
    await workbook.update({ status: newStatus });

    res.json({
      success: true,
      message: `Workbook ${newStatus === 'published' ? 'published' : 'unpublished'} successfully`,
      data: { workbook }
    });
  } catch (error) {
    console.error('Toggle publish error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update workbook status'
    });
  }
};
