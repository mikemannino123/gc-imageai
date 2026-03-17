const express = require('express');
const Joi = require('joi');
const { requireAuth } = require('../middleware/auth');
const { getUserBalance } = require('../services/creditLedger');
const db = require('../config/database');

const router = express.Router();

/**
 * GET /users/me
 * Returns the authenticated user's profile, credit balance, and active subscription.
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [balance, subscription] = await Promise.all([
      getUserBalance(req.user.id),
      db.query(
        `SELECT tier, status, current_period_start, current_period_end,
                stripe_subscription_id, storekit_original_transaction_id
         FROM subscriptions
         WHERE user_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
        [req.user.id]
      ),
    ]);

    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.full_name,
        tier: req.user.tier,
        createdAt: req.user.created_at,
      },
      credits: {
        balance,
      },
      subscription: subscription.rows[0] || null,
    });
  } catch (err) {
    console.error('[users/me]', err.message);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load profile' } });
  }
});

const historySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

/**
 * GET /users/me/history
 * Returns a paginated list of the user's past generations.
 *
 * Query params: page (default 1), limit (default 20, max 50)
 */
router.get('/me/history', requireAuth, async (req, res) => {
  const { error, value } = historySchema.validate(req.query);
  if (error) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: error.details[0].message } });
  }

  const { page, limit } = value;
  const offset = (page - 1) * limit;

  try {
    const { rows, rowCount } = await db.query(
      `SELECT id, prompt, type, status, image_url, credits_used, model, created_at
       FROM generations
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const { rows: countRows } = await db.query(
      'SELECT COUNT(*) AS total FROM generations WHERE user_id = $1',
      [req.user.id]
    );

    const total = parseInt(countRows[0].total, 10);

    res.json({
      generations: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('[users/history]', err.message);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load history' } });
  }
});

module.exports = router;
