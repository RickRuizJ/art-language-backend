const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');

const Workbook = sequelize.define('Workbook', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  title: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: {
      notEmpty: { msg: 'Title is required' },
      len: { args: [3, 255], msg: 'Title must be between 3 and 255 characters' }
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  coverImageUrl: {
    type: DataTypes.STRING(1000),
    allowNull: true,
    field: 'cover_image_url'
  },
  status: {
    type: DataTypes.ENUM('draft', 'published'),
    defaultValue: 'draft'
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'created_by',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  subject: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  gradeLevel: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'grade_level'
  },
  displayOrder: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'display_order'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_active'
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  updatedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'updated_at'
  }
}, {
  tableName: 'workbooks',
  timestamps: true,
  underscored: false,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
});

// WorkbookWorksheet junction model
const WorkbookWorksheet = sequelize.define('WorkbookWorksheet', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  workbookId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'workbook_id',
    references: {
      model: 'workbooks',
      key: 'id'
    }
  },
  worksheetId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'worksheet_id',
    references: {
      model: 'worksheets',
      key: 'id'
    }
  },
  displayOrder: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'display_order'
  },
  addedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'added_at'
  }
}, {
  tableName: 'workbook_worksheets',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['workbook_id', 'worksheet_id']
    }
  ]
});

// FileUpload model
const FileUpload = sequelize.define('FileUpload', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  filename: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  originalFilename: {
    type: DataTypes.STRING(500),
    allowNull: false,
    field: 'original_filename'
  },
  filePath: {
    type: DataTypes.TEXT, // CRITICAL FIX: Changed from STRING(1000) to TEXT for large base64
    allowNull: false,
    field: 'file_path'
  },
  fileSize: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'file_size'
  },
  mimeType: {
    type: DataTypes.STRING(100),
    allowNull: false,
    field: 'mime_type'
  },
  uploadedBy: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'uploaded_by',
    references: {
      model: 'users',
      key: 'id'
    }
  },
  entityType: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'entity_type'
  },
  entityId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'entity_id'
  },
  isPublic: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    field: 'is_public'
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  }
}, {
  tableName: 'file_uploads',
  timestamps: false
});

// ─── Associations ─────────────────────────────────────────────────────────────
Workbook.belongsTo(User, {
  foreignKey: 'createdBy',
  as: 'author'
});

// ─── CRITICAL: Define Workbook↔Worksheet M:N association ─────────────────────
// Lazy-require to avoid circular dependency (Worksheet already loaded via controllers)
const Worksheet = require('./Worksheet');

Workbook.belongsToMany(Worksheet, {
  through: WorkbookWorksheet,
  foreignKey: 'workbookId',
  otherKey: 'worksheetId',
  as: 'worksheets'
});

Worksheet.belongsToMany(Workbook, {
  through: WorkbookWorksheet,
  foreignKey: 'worksheetId',
  otherKey: 'workbookId',
  as: 'workbooks'
});

FileUpload.belongsTo(User, {
  foreignKey: 'uploadedBy',
  as: 'uploader'
});

module.exports = { Workbook, WorkbookWorksheet, FileUpload };
