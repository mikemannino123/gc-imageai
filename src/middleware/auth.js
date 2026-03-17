const jwt = require('jsonwebtoken');
const db = require('../config/database');

/**
 * Verifies the Bearer JWT and attaches the full user row to req.user.
 * Returns 401 if token is missing, invalid, or the user no longer exists.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'MISSING_TOKEN', message: 'Authorization header required' } });
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: {
        code: expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
        message: expired ? 'Token has expired' : 'Invalid token',
      },
    });
  }

  try {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    if (!rows.length) {
      return res.status(401).json({ error: { code: 'USER_NOT_FOUND', message: 'User no longer exists' } });
    }
    req.user = rows[0];
    next();
  } catch (err) {
    console.error('[auth] DB error during auth:', err.message);
    return res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Authentication failed' } });
  }
}

/**
 * Verifies the admin secret key passed via X-Admin-Key header or ?key= query param.
 * Used to protect the admin dashboard and admin API routes.
 */
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (!key || key !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid admin key' } });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
