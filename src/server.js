require('dotenv').config();
const app = require('./app');
const sequelize = require('./config/database');

const PORT = process.env.PORT || 5000;

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error);
  console.error('Stack:', error.stack);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
});

// Database connection and server start
const startServer = async () => {
  try {
    console.log('🔄 Starting server...');
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`🗄️  Database URL: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
    
    // Test database connection
    console.log('🔄 Connecting to database...');
    await sequelize.authenticate();
    console.log('✅ Database connected successfully');

    // Sync models (use { alter: false } in production to avoid auto-migrations)
    console.log('🔄 Syncing database models...');
    const syncOptions = process.env.NODE_ENV === 'production' 
      ? { alter: false } 
      : { alter: true };
    
    await sequelize.sync(syncOptions);
    console.log('✅ Database models synced');

    // Start server - CRITICAL: Bind to 0.0.0.0 for Render
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log('========================================');
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌐 API URL: http://localhost:${PORT}/api`);
      console.log(`💚 Health check: http://localhost:${PORT}/health`);
      console.log('========================================');
    });

    // Keep process alive
    server.on('error', (error) => {
      console.error('❌ Server error:', error);
    });

  } catch (error) {
    console.error('❌ Unable to start server:');
    console.error('Error message:', error.message);
    console.error('Full error:', error);
    console.error('Stack:', error.stack);
    // Don't exit - let Render restart
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('⚠️  SIGTERM received, closing server gracefully...');
  try {
    await sequelize.close();
    console.log('✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
  }
});

process.on('SIGINT', async () => {
  console.log('⚠️  SIGINT received, closing server gracefully...');
  try {
    await sequelize.close();
    console.log('✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
  }
});
