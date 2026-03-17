const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const db = require('../config/database');

const router = express.Router();

// All admin routes require the admin secret key
router.use(requireAdmin);

// ---------------------------------------------------------------------------
// Admin Dashboard HTML — served at GET /admin
// ---------------------------------------------------------------------------
router.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(DASHBOARD_HTML);
});

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

/**
 * GET /admin/api/stats
 * Aggregate platform stats for the dashboard.
 */
router.get('/api/stats', async (_req, res) => {
  try {
    const [users, gens, subs, gensToday] = await Promise.all([
      db.query('SELECT COUNT(*) AS total FROM users'),
      db.query("SELECT COUNT(*) AS total FROM generations WHERE status = 'completed'"),
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active') AS active_total,
          COUNT(*) FILTER (WHERE status = 'active' AND tier = 'pro') AS pro_count,
          COUNT(*) FILTER (WHERE status = 'active' AND tier = 'ultra') AS ultra_count
        FROM subscriptions
      `),
      db.query(`
        SELECT COUNT(*) AS total FROM generations
        WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '24 hours'
      `),
    ]);

    const proCount = parseInt(subs.rows[0].pro_count, 10);
    const ultraCount = parseInt(subs.rows[0].ultra_count, 10);
    // Estimated MRR in USD
    const estimatedMrr = proCount * 6.99 + ultraCount * 12.99;

    res.json({
      totalUsers: parseInt(users.rows[0].total, 10),
      totalGenerations: parseInt(gens.rows[0].total, 10),
      generationsToday: parseInt(gensToday.rows[0].total, 10),
      activeSubscriptions: parseInt(subs.rows[0].active_total, 10),
      proUsers: proCount,
      ultraUsers: ultraCount,
      estimatedMrr: parseFloat(estimatedMrr.toFixed(2)),
    });
  } catch (err) {
    console.error('[admin/stats]', err.message);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load stats' } });
  }
});

/**
 * GET /admin/api/users?page=1&limit=20
 */
router.get('/api/users', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  try {
    const { rows } = await db.query(
      `SELECT
         u.id, u.email, u.full_name, u.tier, u.created_at,
         COALESCE(SUM(cl.amount), 0)::int AS credit_balance,
         COUNT(DISTINCT g.id)::int AS total_generations
       FROM users u
       LEFT JOIN credit_ledger cl ON cl.user_id = u.id
       LEFT JOIN generations g ON g.user_id = u.id AND g.status = 'completed'
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const { rows: countRows } = await db.query('SELECT COUNT(*) AS total FROM users');

    res.json({
      users: rows,
      pagination: {
        page,
        limit,
        total: parseInt(countRows[0].total, 10),
        totalPages: Math.ceil(parseInt(countRows[0].total, 10) / limit),
      },
    });
  } catch (err) {
    console.error('[admin/users]', err.message);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load users' } });
  }
});

/**
 * GET /admin/api/users/:id
 */
router.get('/api/users/:id', async (req, res) => {
  try {
    const { rows: userRows } = await db.query(
      'SELECT * FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!userRows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    const [balance, gens, subs, ledger] = await Promise.all([
      db.query(
        'SELECT COALESCE(SUM(amount), 0)::int AS balance FROM credit_ledger WHERE user_id = $1',
        [req.params.id]
      ),
      db.query(
        `SELECT id, prompt, type, status, image_url, credits_used, model, created_at
         FROM generations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [req.params.id]
      ),
      db.query(
        'SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC',
        [req.params.id]
      ),
      db.query(
        'SELECT * FROM credit_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20',
        [req.params.id]
      ),
    ]);

    res.json({
      user: userRows[0],
      creditBalance: balance.rows[0].balance,
      recentGenerations: gens.rows,
      subscriptions: subs.rows,
      recentLedger: ledger.rows,
    });
  } catch (err) {
    console.error('[admin/users/:id]', err.message);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load user detail' } });
  }
});

/**
 * GET /admin/api/generations?page=1&limit=20
 */
router.get('/api/generations', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  try {
    const { rows } = await db.query(
      `SELECT g.id, g.prompt, g.type, g.status, g.image_url, g.credits_used, g.model,
              g.created_at, u.email, u.full_name, u.tier
       FROM generations g
       JOIN users u ON u.id = g.user_id
       ORDER BY g.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const { rows: countRows } = await db.query('SELECT COUNT(*) AS total FROM generations');

    res.json({
      generations: rows,
      pagination: {
        page,
        limit,
        total: parseInt(countRows[0].total, 10),
        totalPages: Math.ceil(parseInt(countRows[0].total, 10) / limit),
      },
    });
  } catch (err) {
    console.error('[admin/generations]', err.message);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to load generations' } });
  }
});

// ---------------------------------------------------------------------------
// Dashboard HTML (inline to keep admin as a single route file)
// ---------------------------------------------------------------------------
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GC ImageAI — Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f13; color: #e2e2e8; min-height: 100vh; }
    header { background: #18181f; border-bottom: 1px solid #2a2a35; padding: 16px 32px; display: flex; align-items: center; gap: 12px; }
    header h1 { font-size: 18px; font-weight: 600; }
    header .badge { background: #7c3aed; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 99px; }
    main { padding: 32px; max-width: 1280px; margin: 0 auto; }
    .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .stat { background: #18181f; border: 1px solid #2a2a35; border-radius: 10px; padding: 20px; }
    .stat .label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px; }
    .stat .value { font-size: 28px; font-weight: 700; }
    .stat .value.green { color: #34d399; }
    .stat .value.purple { color: #a78bfa; }
    .stat .value.blue { color: #60a5fa; }
    .section { background: #18181f; border: 1px solid #2a2a35; border-radius: 10px; padding: 24px; margin-bottom: 24px; }
    .section h2 { font-size: 15px; font-weight: 600; margin-bottom: 16px; color: #c4c4d0; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: #666; font-weight: 500; padding: 8px 12px; border-bottom: 1px solid #2a2a35; }
    td { padding: 10px 12px; border-bottom: 1px solid #1e1e28; color: #ccc; }
    tr:last-child td { border-bottom: none; }
    .tier { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
    .tier.free { background: #1f1f2e; color: #888; }
    .tier.pro { background: #1e3a5f; color: #60a5fa; }
    .tier.ultra { background: #2d1f4e; color: #a78bfa; }
    .status { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; }
    .status.completed { background: #052e16; color: #34d399; }
    .status.failed { background: #2d0e0e; color: #f87171; }
    .status.pending { background: #1c1a0f; color: #fbbf24; }
    .prompt { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e2e2e8; }
    .loading { color: #555; font-style: italic; }
    .error { color: #f87171; }
    .refresh { float: right; background: #2a2a35; border: none; color: #aaa; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 12px; }
    .refresh:hover { background: #3a3a45; color: #fff; }
  </style>
</head>
<body>
  <header>
    <h1>GC ImageAI</h1>
    <span class="badge">Admin</span>
  </header>
  <main>
    <div class="stats" id="stats">
      <div class="stat"><div class="label">Total Users</div><div class="value" id="s-users">—</div></div>
      <div class="stat"><div class="label">Generations Today</div><div class="value blue" id="s-today">—</div></div>
      <div class="stat"><div class="label">Total Generations</div><div class="value" id="s-gens">—</div></div>
      <div class="stat"><div class="label">Active Subs</div><div class="value purple" id="s-subs">—</div></div>
      <div class="stat"><div class="label">Pro Users</div><div class="value blue" id="s-pro">—</div></div>
      <div class="stat"><div class="label">Ultra Users</div><div class="value purple" id="s-ultra">—</div></div>
      <div class="stat"><div class="label">Est. MRR</div><div class="value green" id="s-mrr">—</div></div>
    </div>

    <div class="section">
      <h2>Recent Generations <button class="refresh" onclick="loadGenerations()">Refresh</button></h2>
      <table>
        <thead><tr><th>Prompt</th><th>Type</th><th>Status</th><th>User</th><th>Tier</th><th>Time</th></tr></thead>
        <tbody id="gens-body"><tr><td colspan="6" class="loading">Loading…</td></tr></tbody>
      </table>
    </div>

    <div class="section">
      <h2>Recent Users <button class="refresh" onclick="loadUsers()">Refresh</button></h2>
      <table>
        <thead><tr><th>Email / Name</th><th>Tier</th><th>Credits</th><th>Generations</th><th>Joined</th></tr></thead>
        <tbody id="users-body"><tr><td colspan="5" class="loading">Loading…</td></tr></tbody>
      </table>
    </div>
  </main>

  <script>
    const key = new URLSearchParams(location.search).get('key') || '';
    const headers = { 'X-Admin-Key': key };

    function fmt(date) {
      return new Date(date).toLocaleString();
    }

    async function loadStats() {
      try {
        const r = await fetch('/admin/api/stats', { headers });
        const d = await r.json();
        document.getElementById('s-users').textContent = d.totalUsers.toLocaleString();
        document.getElementById('s-today').textContent = d.generationsToday.toLocaleString();
        document.getElementById('s-gens').textContent = d.totalGenerations.toLocaleString();
        document.getElementById('s-subs').textContent = d.activeSubscriptions.toLocaleString();
        document.getElementById('s-pro').textContent = d.proUsers.toLocaleString();
        document.getElementById('s-ultra').textContent = d.ultraUsers.toLocaleString();
        document.getElementById('s-mrr').textContent = '$' + d.estimatedMrr.toLocaleString('en-US', { minimumFractionDigits: 2 });
      } catch(e) { console.error(e); }
    }

    async function loadGenerations() {
      const tbody = document.getElementById('gens-body');
      tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading…</td></tr>';
      try {
        const r = await fetch('/admin/api/generations?limit=25', { headers });
        const d = await r.json();
        if (!d.generations?.length) { tbody.innerHTML = '<tr><td colspan="6" class="loading">No generations yet.</td></tr>'; return; }
        tbody.innerHTML = d.generations.map(g => \`
          <tr>
            <td class="prompt" title="\${g.prompt}">\${g.prompt}</td>
            <td>\${g.type === 'image_to_image' ? '🖼 i2i' : '✏️ t2i'}</td>
            <td><span class="status \${g.status}">\${g.status}</span></td>
            <td>\${g.email || g.full_name || '—'}</td>
            <td><span class="tier \${g.tier}">\${g.tier}</span></td>
            <td>\${fmt(g.created_at)}</td>
          </tr>
        \`).join('');
      } catch(e) { tbody.innerHTML = '<tr><td colspan="6" class="error">Failed to load.</td></tr>'; }
    }

    async function loadUsers() {
      const tbody = document.getElementById('users-body');
      tbody.innerHTML = '<tr><td colspan="5" class="loading">Loading…</td></tr>';
      try {
        const r = await fetch('/admin/api/users?limit=25', { headers });
        const d = await r.json();
        if (!d.users?.length) { tbody.innerHTML = '<tr><td colspan="5" class="loading">No users yet.</td></tr>'; return; }
        tbody.innerHTML = d.users.map(u => \`
          <tr>
            <td>\${u.email || u.full_name || '<em>Anonymous</em>'}</td>
            <td><span class="tier \${u.tier}">\${u.tier}</span></td>
            <td>\${u.credit_balance}</td>
            <td>\${u.total_generations}</td>
            <td>\${fmt(u.created_at)}</td>
          </tr>
        \`).join('');
      } catch(e) { tbody.innerHTML = '<tr><td colspan="5" class="error">Failed to load.</td></tr>'; }
    }

    loadStats();
    loadGenerations();
    loadUsers();
  </script>
</body>
</html>`;

module.exports = router;
