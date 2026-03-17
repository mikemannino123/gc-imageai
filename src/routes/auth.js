const express = require('express');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { verifyAppleIdentityToken } = require('../services/appleAuth');
const { createSignupBonus } = require('../services/creditLedger');
const db = require('../config/database');
const { authLimiter } = require('../middleware/rateLimits');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const appleSignInSchema = Joi.object({
  identityToken: Joi.string().required(),
  fullName: Joi.string().max(255).optional().allow('', null),
  email: Joi.string().email().optional().allow('', null),
});

/**
 * POST /auth/apple
 * Exchange an Apple identity token for a GC ImageAI JWT.
 * Creates a new user on first sign-in.
 *
 * Body: { identityToken, fullName?, email? }
 * Response: { token, expiresIn, user }
 */
router.post('/apple', authLimiter, async (req, res) => {
  const { error, value } = appleSignInSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: error.details[0].message } });
  }

  const { identityToken, fullName, email } = value;

  let appleClaims;
  try {
    appleClaims = await verifyAppleIdentityToken(identityToken);
  } catch (err) {
    return res.status(401).json({ error: { code: 'INVALID_APPLE_TOKEN', message: 'Apple identity token is invalid or expired' } });
  }

  const appleUserId = appleClaims.sub;
  // Apple only sends email on the very first sign-in; use what we get
  const resolvedEmail = email || appleClaims.email || null;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Try to find existing user
    const { rows: existing } = await client.query(
      'SELECT * FROM users WHERE apple_user_id = $1',
      [appleUserId]
    );

    let user;
    let isNewUser = false;

    if (existing.length) {
      user = existing[0];
      // Update name/email if Apple provided fresh data this login
      if ((fullName && !user.full_name) || (resolvedEmail && !user.email)) {
        const { rows: updated } = await client.query(
          `UPDATE users SET
             full_name = COALESCE(NULLIF($1, ''), full_name),
             email     = COALESCE($2, email)
           WHERE id = $3 RETURNING *`,
          [fullName || null, resolvedEmail, user.id]
        );
        user = updated[0];
      }
    } else {
      // Create new user
      const { rows: created } = await client.query(
        `INSERT INTO users (apple_user_id, email, full_name)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [appleUserId, resolvedEmail, fullName || null]
      );
      user = created[0];
      isNewUser = true;

      // Award signup bonus inside the same transaction
      await createSignupBonus(user.id, client);
    }

    await client.query('COMMIT');

    const token = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '30d',
    });

    return res.status(isNewUser ? 201 : 200).json({
      token,
      expiresIn: process.env.JWT_EXPIRES_IN || '30d',
      user: sanitizeUser(user),
      isNewUser,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[auth/apple] Error:', err.message);
    return res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Sign-in failed' } });
  } finally {
    client.release();
  }
});

/**
 * GET /auth/me
 * Returns the authenticated user's profile.
 */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    tier: user.tier,
    createdAt: user.created_at,
  };
}

module.exports = router;
