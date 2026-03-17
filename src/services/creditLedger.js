const db = require('../config/database');

/**
 * Returns the current credit balance for a user by summing the ledger.
 * @param {string} userId
 * @param {object} [client]  Optional pg client (for use inside a transaction)
 */
async function getUserBalance(userId, client = null) {
  const conn = client || db;
  const { rows } = await conn.query(
    'SELECT COALESCE(SUM(amount), 0)::int AS balance FROM credit_ledger WHERE user_id = $1',
    [userId]
  );
  return rows[0].balance;
}

/**
 * Adds credits to a user's ledger (positive entry).
 * @param {string} userId
 * @param {number} amount       Must be positive
 * @param {string} reason       One of the credit_reason enum values
 * @param {object} [metadata]
 * @param {object} [client]     Optional pg client
 */
async function creditUser(userId, amount, reason, metadata = {}, client = null) {
  if (amount <= 0) throw new Error('Credit amount must be positive');
  const conn = client || db;
  await conn.query(
    `INSERT INTO credit_ledger (user_id, amount, reason, metadata)
     VALUES ($1, $2, $3, $4)`,
    [userId, amount, reason, JSON.stringify(metadata)]
  );
}

/**
 * Debits credits from a user's ledger (negative entry).
 * @param {string} userId
 * @param {number} amount         Must be positive (stored as negative)
 * @param {string} generationId   FK to the generation this debit belongs to
 * @param {object} [client]       Optional pg client
 */
async function debitCredits(userId, amount, generationId, client = null) {
  if (amount <= 0) throw new Error('Debit amount must be positive');
  const conn = client || db;
  await conn.query(
    `INSERT INTO credit_ledger (user_id, amount, reason, generation_id)
     VALUES ($1, $2, 'generation_use', $3)`,
    [userId, -amount, generationId]
  );
}

/**
 * Awards the 10-credit signup bonus to a new free-tier user.
 */
async function createSignupBonus(userId, client = null) {
  await creditUser(
    userId,
    10,
    'signup_bonus',
    { note: 'Free tier lifetime credits' },
    client
  );
}

/**
 * Awards the monthly subscription credit top-up.
 * Both Pro and Ultra tiers receive 50 credits per billing cycle.
 */
async function topUpForSubscription(userId, tier, subscriptionId, client = null) {
  await creditUser(
    userId,
    50,
    'subscription_topup',
    { tier, subscriptionId, note: `Monthly credit refresh for ${tier}` },
    client
  );
}

/**
 * Refunds credits to a user (e.g. after a failed generation that was debited).
 */
async function refundCredits(userId, amount, reason = 'refund', metadata = {}, client = null) {
  await creditUser(userId, amount, reason, metadata, client);
}

module.exports = {
  getUserBalance,
  creditUser,
  debitCredits,
  createSignupBonus,
  topUpForSubscription,
  refundCredits,
};
