const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Log pool errors without exposing connection string details
  console.error('[db] Unexpected pool error:', err.message);
});

/**
 * Run a single parameterized query.
 * @param {string} text
 * @param {any[]} [params]
 */
const query = (text, params) => pool.query(text, params);

/**
 * Check out a client for use in manual transactions.
 * Remember to call client.release() in a finally block.
 */
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
