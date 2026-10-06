require('dotenv').config();
const app = require('./app');
const sequelize = require('./config/database');
const PORT = process.env.PORT || 5000;

process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', error);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ UNHANDLED REJECTION:', reason);
});

if (!process.env.JWT_SECRET) {
  console.error('❌ Falta JWT_SECRET: el login no funcionará hasta configurarlo.');
}

/**
 * Se abre el puerto PRIMERO y la base de datos se conecta con reintentos en
 * segundo plano. Así Render detecta el servicio como vivo aunque Neon esté
 * despertando, y /health informa del estado real de la base de datos en lugar
 * de dejar el proceso colgado sin escuchar.
 */
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💚 Health check: /health`);
  console.log('========================================');
});

// Render/Cloudflare mantienen conexiones abiertas más tiempo que el valor por
// defecto de Node (5 s); sin esto aparecen errores 502 intermitentes.
server.keepAliveTimeout = 120 * 1000;
server.headersTimeout   = 125 * 1000;
server.on('error', (error) => console.error('❌ Server error:', error));

async function connectDatabase(attempt = 1) {
  const maxAttempts = 8;
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected successfully');

    // Las migraciones del repositorio son idempotentes (IF NOT EXISTS) y quedan
    // registradas en schema_migrations. Correrlas al arrancar evita que falten
    // tablas como file_uploads o messages tras un despliegue. Para desactivarlo:
    // AUTO_MIGRATE=false.
    if (process.env.AUTO_MIGRATE !== 'false') {
      try {
        await require('./config/migrate').runMigrations();
      } catch (migrationError) {
        console.error(`❌ Las migraciones fallaron: ${migrationError.message}`);
      }
    }
  } catch (error) {
    console.error(`❌ Database connection failed (attempt ${attempt}/${maxAttempts}): ${error.message}`);
    if (attempt < maxAttempts) {
      setTimeout(() => connectDatabase(attempt + 1), Math.min(2000 * attempt, 15000));
    }
  }
}
connectDatabase();

async function shutdown(signal) {
  console.log(`⚠️  ${signal} received, closing server gracefully...`);
  server.close(async () => {
    try {
      await sequelize.close();
      console.log('✅ Database connection closed');
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
