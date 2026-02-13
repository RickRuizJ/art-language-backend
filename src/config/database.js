const { Sequelize } = require('sequelize');

// Database configuration with SSL support for Render
const isProduction = process.env.NODE_ENV === 'production';

// Parse DATABASE_URL or use default
const databaseUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/artlanguage';

const sequelize = new Sequelize(databaseUrl, {
  dialect: 'postgres',
  
  // Logging: verbose in development, silent in production
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  
  // SSL configuration for production (Render, Heroku, etc.)
  dialectOptions: isProduction ? {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  } : {},
  
  // Connection pool settings
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  
  // Model defaults
  define: {
    timestamps: true,
    underscored: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  }
});

module.exports = sequelize;
