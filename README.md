# GC ImageAI — Backend API

Node.js + Express backend for the GC ImageAI iMessage App Extension.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 4 |
| Database | PostgreSQL (Supabase) |
| Image storage | Cloudflare R2 (S3-compatible) |
| AI generation | SiliconFlow (FLUX.1-schnell, FLUX.1-Kontext-pro) |
| Payments | Stripe + StoreKit 2 |
| Auth | Apple Sign-In + JWT |
| Hosting | Railway |

---

## Local Setup

### 1. Prerequisites

- Node.js ≥ 18
- A [Supabase](https://supabase.com) project (free tier works)
- A [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket
- A [SiliconFlow](https://cloud.siliconflow.cn) account with API key
- A [Stripe](https://stripe.com) account (test mode is fine)
- [Stripe CLI](https://stripe.com/docs/stripe-cli) for local webhook testing

### 2. Install dependencies

```bash
cd gc-imageai-backend
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in every variable. See the comments in `.env.example` for where to find each value.

Key things to set up:
- **DATABASE_URL** — Supabase project connection string (use the Transaction pooler URL)
- **JWT_SECRET** — run `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` and paste the output
- **APPLE_APP_BUNDLE_ID** — must match the bundle ID in your Xcode project
- **R2_*** — create a bucket in Cloudflare R2 and generate an API token
- **SILICONFLOW_API_KEY** — from the SiliconFlow dashboard
- **ADMIN_SECRET_KEY** — run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste

### 4. Run database migrations

```bash
npm run migrate
```

This creates all tables, indexes, enums, and triggers defined in `migrations/001_initial_schema.sql`.

### 5. Start the development server

```bash
npm run dev
```

The server starts on `http://localhost:3000` (or `$PORT` if set).

### 6. Forward Stripe webhooks (for subscription testing)

```bash
stripe listen --forward-to localhost:3000/subscriptions/stripe/webhook
```

Copy the webhook signing secret printed by the CLI and set it as `STRIPE_WEBHOOK_SECRET` in your `.env`.

---

## API Reference

All endpoints return JSON. Errors follow the shape `{ error: { code, message } }`.

### Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/apple` | — | Exchange Apple identity token for JWT |
| `GET` | `/auth/me` | JWT | Get current user profile |

**POST /auth/apple**
```json
{
  "identityToken": "<JWS from Apple Sign-In>",
  "fullName": "Jane Doe",
  "email": "jane@example.com"
}
```
Returns `{ token, expiresIn, user, isNewUser }`. New users automatically receive 10 free credits.

---

### Image Generation

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/generate` | JWT | Generate an AI image |

**POST /generate** — `multipart/form-data` (or `application/json` for text-only)

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string | Yes | 1–1000 characters |
| `type` | string | No | `text_to_image` (default) or `image_to_image` |
| `image` | file | If `image_to_image` | JPEG / PNG / WebP / HEIC, max 10 MB |

Returns `{ imageUrl, creditsRemaining, generationId }`.

- Text-to-image costs **1 credit** (all tiers).
- Image-to-image costs **2 credits** (Ultra tier only).
- Credits are only debited on successful generation.

---

### Users

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/users/me` | JWT | Profile + credit balance + active subscription |
| `GET` | `/users/me/history` | JWT | Paginated generation history |

**GET /users/me/history** query params: `page` (default 1), `limit` (default 20, max 50)

---

### Subscriptions

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/subscriptions/storekit/verify` | JWT | Verify StoreKit 2 purchase and activate tier |
| `POST` | `/subscriptions/stripe/webhook` | Stripe sig | Handle Stripe billing events |
| `GET` | `/subscriptions/current` | JWT | Get active subscription |

**POST /subscriptions/storekit/verify**
```json
{ "signedTransaction": "<JWSTransaction string from StoreKit 2>" }
```

---

### Admin Dashboard

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/admin` | `X-Admin-Key` | Dashboard UI |
| `GET` | `/admin/api/stats` | `X-Admin-Key` | Aggregate stats |
| `GET` | `/admin/api/users` | `X-Admin-Key` | Paginated user list |
| `GET` | `/admin/api/users/:id` | `X-Admin-Key` | User detail |
| `GET` | `/admin/api/generations` | `X-Admin-Key` | Recent generations |

Access the dashboard at:
```
http://localhost:3000/admin?key=<ADMIN_SECRET_KEY>
```

Pass the key via `X-Admin-Key` header for API calls.

---

### Health

```
GET /health  →  { status: "ok", timestamp: "..." }
```

---

## Project Structure

```
gc-imageai-backend/
├── src/
│   ├── app.js                   Express entry point
│   ├── config/
│   │   ├── database.js          pg Pool
│   │   └── r2.js                Cloudflare R2 S3 client
│   ├── middleware/
│   │   ├── auth.js              JWT + admin key verification
│   │   └── rateLimits.js        Per-route rate limiters
│   ├── routes/
│   │   ├── auth.js              Apple Sign-In, /auth/me
│   │   ├── generate.js          POST /generate
│   │   ├── users.js             Profile + history
│   │   ├── subscriptions.js     StoreKit + Stripe webhook
│   │   └── admin.js             Dashboard + admin API
│   └── services/
│       ├── appleAuth.js         Apple identity token verification
│       ├── creditLedger.js      Credit read/write operations
│       ├── r2Storage.js         R2 upload + URL helpers
│       ├── siliconFlow.js       SiliconFlow API (FLUX models)
│       └── stripeService.js     Stripe event handlers
├── migrations/
│   └── 001_initial_schema.sql   Full DB schema
├── scripts/
│   └── migrate.js               Migration runner
├── .env.example
└── package.json
```

---

## Credit Ledger Design

Credits are stored as an **append-only ledger** (`credit_ledger` table). The current balance is always computed as `SUM(amount)` — positive entries add credits, negative entries deduct them.

| Reason | Amount |
|---|---|
| `signup_bonus` | +10 (free tier, one-time) |
| `subscription_topup` | +50 (monthly, on renewal) |
| `generation_use` | −1 or −2 |
| `admin_grant` | any positive |
| `refund` | any positive |

Credits are **only debited after a successful generation and R2 upload** — if the AI call fails, no credits are lost.

---

## Deployment (Railway)

1. Push this repo to GitHub.
2. Create a new Railway project and connect the repo.
3. Add all environment variables from `.env.example` in Railway's Variables tab.
4. Set `NODE_ENV=production`.
5. Run migrations once: `npm run migrate` (Railway → Deploy → Run command, or via a one-off process).
6. The server starts automatically via `npm start`.

Railway auto-detects Node.js and sets `PORT` — the app reads `process.env.PORT` so no changes needed.
