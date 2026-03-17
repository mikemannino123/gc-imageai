const axios = require('axios');
const db = require('../config/database');

// ---------------------------------------------------------------------------
// RevenueCat REST API client
// Docs: https://www.revenuecat.com/reference/basic
// ---------------------------------------------------------------------------
const rcClient = axios.create({
  baseURL: 'https://api.revenuecat.com/v1',
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

rcClient.interceptors.request.use((config) => {
  config.headers['Authorization'] = `Bearer ${process.env.REVENUECAT_SECRET_KEY}`;
  return config;
});

/**
 * Fetches a subscriber's full info from RevenueCat.
 * We use the user's internal UUID as the RevenueCat app user ID —
 * the iOS SDK must call Purchases.shared.logIn(appUserID: user.id) after sign-in.
 *
 * @param {string} userId  Our internal user UUID
 */
async function getSubscriberInfo(userId) {
  const response = await rcClient.get(`/subscribers/${encodeURIComponent(userId)}`);
  return response.data.subscriber;
}

/**
 * Determines the active tier from a RevenueCat subscriber's entitlements.
 * Entitlement identifiers must match what's configured in the RevenueCat dashboard.
 * Expected identifiers: "ultra", "pro"
 *
 * @param {object} entitlements  subscriber.entitlements from RC response
 * @returns {'ultra'|'pro'|'free'}
 */
function getTierFromEntitlements(entitlements = {}) {
  const isActive = (e) =>
    e && (e.expires_date === null || new Date(e.expires_date) > new Date());

  if (isActive(entitlements.ultra)) return 'ultra';
  if (isActive(entitlements.pro)) return 'pro';
  return 'free';
}

/**
 * Calls RevenueCat to get the user's current tier, updates the DB if it has
 * changed, and returns the authoritative tier.
 *
 * Used in the /generate route to ensure we always act on the latest
 * subscription state before processing a request.
 *
 * Falls back gracefully — callers should catch errors and use the cached
 * DB tier when RevenueCat is unreachable.
 *
 * @param {string} userId
 * @returns {Promise<'ultra'|'pro'|'free'>}
 */
async function syncSubscriberTier(userId) {
  const subscriber = await getSubscriberInfo(userId);
  const rcTier = getTierFromEntitlements(subscriber.entitlements);

  // Update DB tier if RevenueCat disagrees with what we have cached
  await db.query(
    'UPDATE users SET tier = $1 WHERE id = $2 AND tier != $1',
    [rcTier, userId]
  );

  // Upsert the subscription record so the dashboard reflects current state
  if (rcTier !== 'free') {
    // Find the active entitlement details
    const entitlement = subscriber.entitlements[rcTier];
    await db.query(
      `INSERT INTO subscriptions (user_id, tier, status, entitlement, revenuecat_product_id, expires_date)
       VALUES ($1, $2, 'active', $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         tier = EXCLUDED.tier,
         status = 'active',
         entitlement = EXCLUDED.entitlement,
         revenuecat_product_id = EXCLUDED.revenuecat_product_id,
         expires_date = EXCLUDED.expires_date,
         updated_at = NOW()`,
      [
        userId,
        rcTier,
        rcTier,
        entitlement?.product_identifier || null,
        entitlement?.expires_date || null,
      ]
    );
  } else {
    // Mark any active subscription as expired if RC says they're free
    await db.query(
      `UPDATE subscriptions SET status = 'expired', updated_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
  }

  return rcTier;
}

/**
 * Verifies the Authorization header on incoming RevenueCat webhooks.
 * Set the expected value in RevenueCat Dashboard → Project Settings → Webhooks.
 *
 * @param {string} authHeader  Value of the Authorization header
 * @returns {boolean}
 */
function verifyWebhookAuth(authHeader) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[revenuecat] REVENUECAT_WEBHOOK_SECRET not set — skipping webhook auth check');
    return true;
  }
  return authHeader === secret;
}

module.exports = {
  getSubscriberInfo,
  getTierFromEntitlements,
  syncSubscriberTier,
  verifyWebhookAuth,
};
