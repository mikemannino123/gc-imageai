const Stripe = require('stripe');
const db = require('../config/database');
const creditLedger = require('./creditLedger');

// Stripe client initialised lazily so tests can set env vars first
let _stripe = null;
function stripe() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });
  return _stripe;
}

// Map Stripe price IDs → internal tiers
function tierFromPriceId(priceId) {
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_ULTRA) return 'ultra';
  return null;
}

/**
 * Creates or retrieves a Stripe customer for a user.
 */
async function getOrCreateCustomer(user) {
  const { rows } = await db.query(
    'SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 AND stripe_customer_id IS NOT NULL LIMIT 1',
    [user.id]
  );
  if (rows.length) return rows[0].stripe_customer_id;

  const customer = await stripe().customers.create({
    email: user.email || undefined,
    name: user.full_name || undefined,
    metadata: { userId: user.id },
  });
  return customer.id;
}

// ---------------------------------------------------------------------------
// Webhook event handlers
// ---------------------------------------------------------------------------

async function handleSubscriptionCreated(subscription) {
  const customerId = subscription.customer;
  const priceId = subscription.items.data[0]?.price?.id;
  const tier = tierFromPriceId(priceId);
  if (!tier) return;

  const { rows } = await db.query(
    'SELECT id, tier FROM users WHERE id = (SELECT metadata->>\'userId\' FROM (SELECT metadata FROM stripe_customers LIMIT 0) x) LIMIT 1'
  );
  // Look up user via customer metadata
  const customer = await stripe().customers.retrieve(customerId);
  const userId = customer.metadata?.userId;
  if (!userId) return;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Upsert subscription record
    await client.query(
      `INSERT INTO subscriptions
         (user_id, tier, status, stripe_subscription_id, stripe_customer_id,
          current_period_start, current_period_end)
       VALUES ($1, $2, 'active', $3, $4, to_timestamp($5), to_timestamp($6))
       ON CONFLICT (stripe_subscription_id) DO UPDATE SET
         status = 'active',
         tier = EXCLUDED.tier,
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end,
         updated_at = NOW()`,
      [
        userId, tier, subscription.id, customerId,
        subscription.current_period_start,
        subscription.current_period_end,
      ]
    );

    // Upgrade user tier
    await client.query('UPDATE users SET tier = $1 WHERE id = $2', [tier, userId]);

    // Award monthly credits
    await creditLedger.topUpForSubscription(userId, tier, subscription.id, client);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function handleInvoicePaymentSucceeded(invoice) {
  // Top up credits on each successful renewal
  if (invoice.billing_reason !== 'subscription_cycle') return;

  const subscriptionId = invoice.subscription;
  const { rows } = await db.query(
    'SELECT user_id, tier FROM subscriptions WHERE stripe_subscription_id = $1',
    [subscriptionId]
  );
  if (!rows.length) return;

  const { user_id: userId, tier } = rows[0];
  await creditLedger.topUpForSubscription(userId, tier, subscriptionId);

  // Refresh period dates
  const sub = await stripe().subscriptions.retrieve(subscriptionId);
  await db.query(
    `UPDATE subscriptions SET
       current_period_start = to_timestamp($1),
       current_period_end   = to_timestamp($2),
       status = 'active'
     WHERE stripe_subscription_id = $3`,
    [sub.current_period_start, sub.current_period_end, subscriptionId]
  );
}

async function handleSubscriptionDeleted(subscription) {
  await db.query(
    `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [subscription.id]
  );

  // Downgrade user tier
  const { rows } = await db.query(
    'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1',
    [subscription.id]
  );
  if (rows.length) {
    await db.query("UPDATE users SET tier = 'free' WHERE id = $1", [rows[0].user_id]);
  }
}

async function handleSubscriptionUpdated(subscription) {
  const priceId = subscription.items.data[0]?.price?.id;
  const tier = tierFromPriceId(priceId);
  if (!tier) return;

  const { rows } = await db.query(
    'SELECT user_id FROM subscriptions WHERE stripe_subscription_id = $1',
    [subscription.id]
  );
  if (!rows.length) return;

  const userId = rows[0].user_id;
  await db.query(
    `UPDATE subscriptions SET tier = $1, status = $2, updated_at = NOW()
     WHERE stripe_subscription_id = $3`,
    [tier, subscription.status === 'active' ? 'active' : subscription.status, subscription.id]
  );
  await db.query('UPDATE users SET tier = $1 WHERE id = $2', [tier, userId]);
}

/**
 * Constructs and verifies a Stripe webhook event from raw request body + signature.
 */
function constructWebhookEvent(rawBody, signature) {
  return stripe().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

module.exports = {
  getOrCreateCustomer,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentSucceeded,
  constructWebhookEvent,
};
