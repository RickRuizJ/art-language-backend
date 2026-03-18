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

const app = express();

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:3001',
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});
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
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
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
