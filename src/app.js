'use strict';
/**
 * src/app.js
 *
 * BUGS FIXED:
 * The original app.js never mounted /api/teachers or /api/students routes.
 * Every request to GET /api/teachers/students or GET /api/students/dashboard
 * returned 404 "Route not found" — causing the teacher dashboard and student
 * pages to show empty data / redirect to login.
 *
 * FIX: Add app.use() for both teacherRoutes and studentRoutes.
 */

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const compression  = require('compression');
const rateLimit    = require('express-rate-limit');
const errorHandler = require('./middleware/errorHandler');
const sequelize    = require('./config/database');

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes       = require('./routes/auth');
const userRoutes       = require('./routes/users');
const worksheetRoutes  = require('./routes/worksheets');
const groupRoutes      = require('./routes/groups');
const submissionRoutes = require('./routes/submissions');
const materialRoutes   = require('./routes/materials');
const workbookRoutes   = require('./routes/workbooks');
// FIX: These two were never imported or mounted in the original app.js
const teacherRoutes    = require('./routes/teacherRoutes');
const studentRoutes    = require('./routes/studentRoutes');
const messageRoutes    = require('./routes/messages');

const app = express();

// Detrás de Render/Vercel todas las peticiones llegan con la IP del proxy: sin esto
// el límite de peticiones se compartía entre TODOS los usuarios.
app.set('trust proxy', 1);

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Production accepts only the configured frontend(s). Add comma-separated
// preview origins through CORS_ORIGINS when they are intentionally needed.
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'https://art-language-frontend.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  ...(process.env.CORS_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean),
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const limitMessage = { success: false, message: 'Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.' };
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || '1000', 10), // un salón completo puede compartir IP
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '40', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/', limiter);

// ─── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Misc middleware ──────────────────────────────────────────────────────────
app.use(compression());

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// ─── Health check ─────────────────────────────────────────────────────────────
async function dbStatus() {
  try {
    await Promise.race([sequelize.query('SELECT 1'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    return 'connected';
  } catch (_) { return 'unavailable'; }
}
function uploadsStatus() {
  try { require('./config/cloudinary').assertConfigured?.(); return 'configured'; }
  catch (_) { return 'missing_configuration'; }
}

// Liveness (Render): siempre 200 mientras el proceso responda; informa de la base de datos y de Cloudinary.
app.get('/health', async (req, res) => {
  res.status(200).json({
    status: 'OK',
    database: await dbStatus(),
    uploads: uploadsStatus(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// Readiness: 503 si la base de datos no responde.
app.get('/health/ready', async (req, res) => {
  const database = await dbStatus();
  res.status(database === 'connected' ? 200 : 503).json({ status: database === 'connected' ? 'READY' : 'NOT_READY', database });
});

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/users',       userRoutes);
app.use('/api/worksheets',  worksheetRoutes);
app.use('/api/groups',      groupRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/materials',   materialRoutes);
app.use('/api/workbooks',   workbookRoutes);
// FIX: Mount the teacher and student routes that were missing
app.use('/api/teachers',    teacherRoutes);
app.use('/api/students',    studentRoutes);
app.use('/api/messages',     messageRoutes);

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

// ─── Error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
