require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const { globalLimiter } = require('./middleware/rateLimits');

const authRoutes = require('./routes/auth');
const generateRoutes = require('./routes/generate');
const userRoutes = require('./routes/users');
const subscriptionRoutes = require('./routes/subscriptions');
const adminRoutes = require('./routes/admin');

const app = express();

// ---------------------------------------------------------------------------
// Security & logging middleware
// ---------------------------------------------------------------------------
app.use(helmet());

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key'],
}));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ---------------------------------------------------------------------------
// Body parsers
//
// IMPORTANT: Stripe webhooks require the RAW body for signature verification.
// Mount the raw-body middleware BEFORE express.json() for the webhook route.
// ---------------------------------------------------------------------------
app.use(
  '/subscriptions/stripe/webhook',
  express.raw({ type: 'application/json' })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ---------------------------------------------------------------------------
// Global rate limiter
// ---------------------------------------------------------------------------
app.use(globalLimiter);

// ---------------------------------------------------------------------------
// Health check (no auth — used by Railway / uptime monitors)
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------
app.use('/auth', authRoutes);
app.use('/generate', generateRoutes);
app.use('/users', userRoutes);
app.use('/subscriptions', subscriptionRoutes);
app.use('/admin', adminRoutes);

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: {
      code: 'SERVER_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message,
    },
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`GC ImageAI backend running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = app;
