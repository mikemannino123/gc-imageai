const express = require('express');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { requireAuth } = require('../middleware/auth');
const { topUpForSubscription } = require('../services/creditLedger');
const {
  constructWebhookEvent,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentSucceeded,
} = require('../services/stripeService');
const db = require('../config/database');

const router = express.Router();

// Apple's JWKS endpoint for verifying StoreKit 2 JWS transactions
const appleStoreKitJwks = jwksClient({
  jwksUri: 'https://appleid.apple.com/auth/keys',
  cache: true,
  cacheMaxAge: 24 * 60 * 60 * 1000,
});

function getStoreKitSigningKey(header, callback) {
  appleStoreKitJwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

/**
 * Verifies a StoreKit 2 signed transaction (JWS) from Apple.
 * Returns the decoded transaction payload.
 */
function verifyStoreKitTransaction(signedTransaction) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      signedTransaction,
      getStoreKitSigningKey,
      { algorithms: ['ES256'] },
      (err, payload) => {
        if (err) reject(err);
        else resolve(payload);
      }
    );
  });
}

// Map StoreKit product IDs → internal tiers
function tierFromProductId(productId) {
  if (productId === process.env.STOREKIT_PRODUCT_PRO) return 'pro';
  if (productId === process.env.STOREKIT_PRODUCT_ULTRA) return 'ultra';
  return null;
}

// ---------------------------------------------------------------------------
// StoreKit 2 — iOS in-app purchase verification
// ---------------------------------------------------------------------------

/**
 * POST /subscriptions/storekit/verify
 *
 * Called by the iOS app after a successful StoreKit 2 purchase.
 * Body: { signedTransaction }  (the JWSTransaction string from StoreKit)
 */
router.post('/storekit/verify', requireAuth, async (req, res) => {
  const { signedTransaction } = req.body;
  if (!signedTransaction) {
    return res.status(400).json({ error: { code: 'MISSING_TRANSACTION', message: 'signedTransaction is required' } });
  }

  let txn;
  try {
    txn = await verifyStoreKitTransaction(signedTransaction);
  } catch (err) {
    return res.status(400).json({ error: { code: 'INVALID_TRANSACTION', message: 'StoreKit transaction verification failed' } });
  }

  const { productId, originalTransactionId, expiresDate, purchaseDate } = txn;
  const tier = tierFromProductId(productId);

  if (!tier) {
    return res.status(400).json({ error: { code: 'UNKNOWN_PRODUCT', message: 'Unrecognized product ID' } });
  }

  const userId = req.user.id;

  // Check if we've already processed this original transaction
  const { rows: existing } = await db.query(
    'SELECT id FROM subscriptions WHERE storekit_original_transaction_id = $1',
    [originalTransactionId]
  );

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    if (existing.length) {
      // Renewal — update period dates
      await client.query(
        `UPDATE subscriptions SET
           status = 'active',
           current_period_start = to_timestamp($1 / 1000.0),
           current_period_end   = to_timestamp($2 / 1000.0),
           storekit_product_id  = $3,
           tier = $4,
           updated_at = NOW()
         WHERE storekit_original_transaction_id = $5`,
        [purchaseDate, expiresDate, productId, tier, originalTransactionId]
      );
      await topUpForSubscription(userId, tier, originalTransactionId, client);
    } else {
      // New subscription
      await client.query(
        `INSERT INTO subscriptions
           (user_id, tier, status, storekit_original_transaction_id, storekit_product_id,
            current_period_start, current_period_end)
         VALUES ($1, $2, 'active', $3, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0))`,
        [userId, tier, originalTransactionId, productId, purchaseDate, expiresDate]
      );
      await topUpForSubscription(userId, tier, originalTransactionId, client);
    }

    // Upgrade user tier
    await client.query('UPDATE users SET tier = $1 WHERE id = $2', [tier, userId]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[subscriptions/storekit]', err.message);
    return res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to activate subscription' } });
  } finally {
    client.release();
  }

  const { rows } = await db.query('SELECT tier FROM users WHERE id = $1', [userId]);
  res.json({ tier: rows[0].tier, message: 'Subscription activated' });
});

// ---------------------------------------------------------------------------
// Stripe webhook — must use raw body for signature verification
// ---------------------------------------------------------------------------

/**
 * POST /subscriptions/stripe/webhook
 *
 * Receives Stripe events. Express must NOT parse the body as JSON for this
 * route — raw body is required for signature verification.
 * Configured in app.js with express.raw({ type: 'application/json' }).
 */
router.post('/stripe/webhook', async (req, res) => {
  const signature = req.headers['stripe-signature'];
  if (!signature) {
    return res.status(400).json({ error: { code: 'MISSING_SIGNATURE', message: 'Stripe signature header missing' } });
  }

  let event;
  try {
    event = constructWebhookEvent(req.body, signature);
  } catch (err) {
    return res.status(400).json({ error: { code: 'INVALID_SIGNATURE', message: 'Stripe signature verification failed' } });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object);
        break;
      default:
        // Acknowledge unhandled events without error
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[stripe/webhook] Handler error for', event.type, ':', err.message);
    // Return 200 to prevent Stripe from retrying a permanent failure;
    // log it for manual investigation
    res.json({ received: true, warning: 'Handler encountered an error' });
  }
});

/**
 * GET /subscriptions/current
 * Returns the user's current active subscription (if any).
 */
router.get('/current', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT tier, status, current_period_start, current_period_end, created_at
       FROM subscriptions
       WHERE user_id = $1 AND status = 'active'
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
