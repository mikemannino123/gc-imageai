const rateLimit = require('express-rate-limit');

const json429 = (req, res) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests — please slow down' } });

/** General API limiter: 200 req / 15 min per IP */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json429,
});

/** Auth endpoints: 20 req / 15 min per IP */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: json429,
});

/**
 * Image generation: 10 req / min per authenticated user.
 * Falls back to IP if user is not yet resolved (shouldn't happen in practice
 * since requireAuth runs first).
 */
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req.user ? req.user.id : req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  handler: json429,
});

module.exports = { globalLimiter, authLimiter, generateLimiter };
