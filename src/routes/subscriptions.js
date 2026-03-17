const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { topUpForSubscription } = require('../services/creditLedger');
const { syncSubscriberTier, verifyWebhookAuth, getTierFromEntitlements, getSubscriberInfo } = require('../services/revenueCat');
const db = require('../config/database');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /subscriptions/revenuecat/sync
//
// Called by the iOS app after a RevenueCat purchase completes.
// Pulls the latest subscriber state from RevenueCat, updates the user's tier
// in our DB, and returns the current tier + credit balance.
//
// The iOS SDK should call Purchases.shared.logIn(appUserID: user.id) after
// sign-in so that RevenueCat can associate purchases with our user IDs.
// ---------------------------------------------------------------------------
router.post('/revenuecat/sync', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const previousTier = req.user.tier;

  let currentTier;
  try {
    currentTier = await syncSubscriberTier(userId);
  } catch (err) {
    console.error('[subscriptions/sync] RevenueCat error:', err.message);
    return res.status(502).json({
      error: { code: 'RC_UNAVAILABLE', message: 'Could not reach RevenueCat to verify subscription' },
    });
  }

  // Award credits if this is a new paid subscription activation
  // (tier went from free → paid, or this is a fresh monthly renewal)
  if (currentTier !== 'free' && previousTier === 'free') {
    try {
      await topUpForSubscription(userId, currentTier, `rc_sync_${Date.now()}`);
    } catch (err) {
      // Non-fatal — credits can be granted manually via admin if needed
      console.error('[subscriptions/sync] Credit top-up failed:', err.message);
    }
  }

  const { rows } = await db.query(
    'SELECT COALESCE(SUM(amount), 0)::int AS balance FROM credit_ledger WHERE user_id = $1',
    [userId]
  );

  res.json({
    tier: currentTier,
    creditBalance: rows[0].balance,
    upgraded: currentTier !== previousTier,
  });
});

// ---------------------------------------------------------------------------
// POST /subscriptions/revenuecat/webhook
//
// Receives real-time subscription events from RevenueCat.
// Configure the webhook URL in RevenueCat Dashboard → Project Settings → Webhooks.
// Set a webhook secret there and add it to REVENUECAT_WEBHOOK_SECRET in .env.
//
// Handled event types:
//   INITIAL_PURCHASE  — new subscriber, top up credits + upgrade tier
//   RENEWAL           — monthly renewal, top up credits
//   PRODUCT_CHANGE    — plan change (pro ↔ ultra), update tier
//   CANCELLATION      — user cancelled (still active until period end)
//   UNCANCELLATION    — user un-cancelled
//   EXPIRATION        — subscription expired, downgrade to free
//   BILLING_ISSUE     — payment failed, mark past_due
// ---------------------------------------------------------------------------
router.post('/revenuecat/webhook', async (req, res) => {
  // Verify the request is actually from RevenueCat
  if (!verifyWebhookAuth(req.headers['authorization'])) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid webhook secret' } });
  }

  const event = req.body?.event;
  if (!event) {
    return res.status(400).json({ error: { code: 'INVALID_PAYLOAD', message: 'Missing event object' } });
  }

  const { type, app_user_id: userId, entitlement_ids, product_id, expiration_at_ms } = event;

  if (!userId) {
    // Anonymous or aliased user — skip; will be resolved on next sync
    return res.json({ received: true });
  }

  // Confirm the user exists in our DB
  const { rows: userRows } = await db.query('SELECT id, tier FROM users WHERE id = $1', [userId]);
  if (!userRows.length) {
    // User not found — could be a test event or a user who deleted their account
    return res.json({ received: true });
  }

  const currentDbTier = userRows[0].tier;

  // Derive the new tier from the entitlement identifiers sent in the event
  const entitlementTier = (() => {
    if (!entitlement_ids?.length) return null;
    if (entitlement_ids.includes('ultra')) return 'ultra';
    if (entitlement_ids.includes('pro')) return 'pro';
    return null;
  })();

  const expiresDate = expiration_at_ms ? new Date(expiration_at_ms).toISOString() : null;

  try {
    switch (type) {
      case 'INITIAL_PURCHASE': {
        if (!entitlementTier) break;
        const client = await db.getClient();
        try {
          await client.query('BEGIN');
          await client.query('UPDATE users SET tier = $1 WHERE id = $2', [entitlementTier, userId]);
          await client.query(
            `INSERT INTO subscriptions (user_id, tier, status, entitlement, revenuecat_product_id, expires_date)
             VALUES ($1, $2, 'active', $3, $4, $5)
             ON CONFLICT (user_id) DO UPDATE SET
               tier = EXCLUDED.tier, status = 'active', entitlement = EXCLUDED.entitlement,
               revenuecat_product_id = EXCLUDED.revenuecat_product_id,
               expires_date = EXCLUDED.expires_date, updated_at = NOW()`,
            [userId, entitlementTier, entitlementTier, product_id, expiresDate]
          );
          await topUpForSubscription(userId, entitlementTier, `rc_initial_${event.id}`, client);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
        break;
      }

      case 'RENEWAL': {
        if (!entitlementTier) break;
        // Top up credits and refresh expiry
        const client = await db.getClient();
        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE subscriptions SET expires_date = $1, status = 'active', updated_at = NOW()
             WHERE user_id = $2`,
            [expiresDate, userId]
          );
          await topUpForSubscription(userId, entitlementTier, `rc_renewal_${event.id}`, client);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
        break;
      }

      case 'PRODUCT_CHANGE': {
        if (!entitlementTier) break;
        await db.query('UPDATE users SET tier = $1 WHERE id = $2', [entitlementTier, userId]);
        await db.query(
          `UPDATE subscriptions SET tier = $1, entitlement = $1, updated_at = NOW() WHERE user_id = $2`,
          [entitlementTier, userId]
        );
        break;
      }

      case 'CANCELLATION':
        // Subscription is cancelled but still active until period end — don't downgrade yet
        await db.query(
          `UPDATE subscriptions SET status = 'cancelled', updated_at = NOW() WHERE user_id = $1`,
          [userId]
        );
        break;

      case 'UNCANCELLATION':
        await db.query(
          `UPDATE subscriptions SET status = 'active', updated_at = NOW() WHERE user_id = $1`,
          [userId]
        );
        break;

      case 'EXPIRATION':
        // Subscription fully expired — downgrade to free
        await db.query(
          `UPDATE subscriptions SET status = 'expired', updated_at = NOW() WHERE user_id = $1`,
          [userId]
        );
        await db.query("UPDATE users SET tier = 'free' WHERE id = $1", [userId]);
        break;

      case 'BILLING_ISSUE':
        await db.query(
          `UPDATE subscriptions SET status = 'past_due', updated_at = NOW() WHERE user_id = $1`,
          [userId]
        );
        break;

      default:
        // Acknowledge unhandled event types (TRANSFER, SUBSCRIBER_ALIAS, etc.)
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error(`[revenuecat/webhook] Handler error for ${type}:`, err.message);
    // Return 200 so RevenueCat doesn't retry indefinitely for non-transient errors
    res.json({ received: true, warning: 'Handler error — check server logs' });
  }
});

// ---------------------------------------------------------------------------
// GET /subscriptions/current
// Returns the user's current subscription record from our DB.
// ---------------------------------------------------------------------------
router.get('/current', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT tier, status, entitlement, revenuecat_product_id, expires_date, created_at
       FROM subscriptions
       WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({ subscription: rows[0] || null });
  } catch (err) {
    console.error('[subscriptions/current]', err.message);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load subscription' } });
  }
});

module.exports = router;
