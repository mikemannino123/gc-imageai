# GC ImageAI — Project Briefing for Claude

Read this file at the start of every session. It contains the full project context, what has been built, what is next, and every decision that has been made.

---

## What This Product Is

**GC ImageAI** is a native iOS app with an embedded iMessage App Extension. It lets users generate AI images directly inside any iMessage group chat by typing a text prompt. Higher-tier users can also attach a photo to remix it (image-to-image). The viral loop is core to the product: one user generates an image in a group chat, everyone else in the thread sees it and gets curious, organic installs follow.

---

## Monetization & Tiers

| Tier | Price | Credits | Modes |
|---|---|---|---|
| Free | $0 | 10 lifetime | Text-to-image only |
| Pro | $6.99/month | 50/month | Text-to-image only |
| Ultra | $12.99/month | 50/month | Text-to-image + image-to-image |

- 1 credit = 1 text-to-image generation
- 2 credits = 1 image-to-image generation (Ultra only)
- Credits are managed server-side; the client never touches credit logic directly
- Apple takes 30% of StoreKit purchases; Stripe handles web/server-side billing

---

## Tech Stack

| Layer | Technology |
|---|---|
| iOS app | Swift 5.9 + SwiftUI |
| iMessage extension | Messages Framework |
| Backend | Node.js + Express |
| Database | PostgreSQL via Supabase |
| Auth | Apple Sign-In + JWT (30-day expiry) |
| Image generation | SiliconFlow — FLUX.1-Kontext-pro |
| Image storage | Cloudflare R2 (S3-compatible) |
| Payments (iOS) | StoreKit 2 |
| Payments (server) | Stripe |
| Hosting | Railway |

---

## Development Phases

### Phase 1 — Backend (COMPLETE)
Full Node.js + Express API. See details below.

### Phase 2 — iMessage Extension (NEXT)
The Xcode work. Targets:
- New Xcode project with a Messages Extension target embedded inside a parent app target
- Main extension UI: prompt text field, optional image picker (Ultra only), Generate button, loading/spinner state, image preview
- Networking layer: `POST /generate` with JWT auth, multipart when image attached
- Keychain: store and retrieve JWT securely
- Apple Sign-In: lightweight flow inside the extension to get a JWT (full onboarding is Phase 3)
- Image insert: download the returned image URL → insert into `MSConversation` active draft as `MSMessage` or `MSSticker`

### Phase 3 — Parent App
- Onboarding screens
- StoreKit 2 subscription purchase flow
- `POST /subscriptions/storekit/verify` called after purchase
- Usage history screen (calls `GET /users/me/history`)
- Account/profile screen (calls `GET /users/me`)

### Phase 4 — Polish
- Dark mode
- Error states and empty states
- App Store screenshots and metadata
- TestFlight distribution

### Phase 5 — Launch
- App Store submission
- Production Railway deploy
- Production Stripe + SiliconFlow keys
- Monitor admin dashboard

---

## Backend — File Structure

```
gc-imageai-backend/
├── src/
│   ├── app.js                        Express entry point, all middleware wired
│   ├── config/
│   │   ├── database.js               pg Pool (query + getClient for transactions)
│   │   └── r2.js                     S3Client pointed at Cloudflare R2
│   ├── middleware/
│   │   ├── auth.js                   requireAuth (JWT) + requireAdmin (secret key)
│   │   └── rateLimits.js             globalLimiter, authLimiter, generateLimiter
│   ├── routes/
│   │   ├── auth.js                   POST /auth/apple, GET /auth/me
│   │   ├── generate.js               POST /generate
│   │   ├── users.js                  GET /users/me, GET /users/me/history
│   │   ├── subscriptions.js          POST /subscriptions/storekit/verify
│   │   │                             POST /subscriptions/stripe/webhook
│   │   │                             GET  /subscriptions/current
│   │   └── admin.js                  GET /admin (dashboard HTML)
│   │                                 GET /admin/api/stats
│   │                                 GET /admin/api/users
│   │                                 GET /admin/api/users/:id
│   │                                 GET /admin/api/generations
│   └── services/
│       ├── appleAuth.js              Verify Apple identity token via JWKS
│       ├── creditLedger.js           getUserBalance, debitCredits, creditUser, etc.
│       ├── r2Storage.js              uploadImage, getSignedUrl, getPublicUrl, getBestUrl
│       ├── siliconFlow.js            generateImage(prompt, referenceImageUrl?)
│       └── stripeService.js          Stripe webhook event handlers
├── migrations/
│   └── 001_initial_schema.sql        All tables, enums, indexes, triggers
├── scripts/
│   └── migrate.js                    Migration runner (tracks applied files)
├── .env.example                      All required env vars documented
├── CLAUDE.md                         This file
├── package.json
└── README.md
```

---

## Database Schema

### `users`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| apple_user_id | VARCHAR UNIQUE | From Apple Sign-In `sub` claim |
| email | VARCHAR | Nullable; Apple only sends on first login |
| full_name | VARCHAR | Nullable |
| tier | ENUM | `free` / `pro` / `ultra` |
| created_at / updated_at | TIMESTAMPTZ | `updated_at` auto-set by trigger |

### `generations`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK → users | |
| prompt | TEXT | |
| type | ENUM | `text_to_image` / `image_to_image` |
| status | ENUM | `pending` / `completed` / `failed` |
| image_url | TEXT | Final URL returned to client |
| r2_key | TEXT | Object key inside R2 bucket |
| credits_used | INTEGER | 1 or 2 |
| model | VARCHAR | Always `FLUX.1-Kontext-pro` |
| metadata | JSONB | Error messages on failure, etc. |
| created_at | TIMESTAMPTZ | |

### `credit_ledger` (append-only)
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK → users | |
| amount | INTEGER | Positive = credit in, negative = debit out |
| reason | ENUM | `signup_bonus` / `subscription_topup` / `generation_use` / `admin_grant` / `refund` |
| generation_id | UUID FK → generations | Set when `reason = generation_use` |
| metadata | JSONB | |
| created_at | TIMESTAMPTZ | |

### `subscriptions`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK → users | |
| tier | ENUM | `pro` / `ultra` |
| status | ENUM | `active` / `cancelled` / `expired` / `past_due` |
| stripe_subscription_id | VARCHAR UNIQUE | Nullable |
| stripe_customer_id | VARCHAR | Nullable |
| storekit_original_transaction_id | VARCHAR UNIQUE | Nullable |
| storekit_product_id | VARCHAR | Nullable |
| current_period_start / end | TIMESTAMPTZ | |
| cancelled_at | TIMESTAMPTZ | |
| created_at / updated_at | TIMESTAMPTZ | |

---

## API Endpoints

All errors return `{ error: { code, message } }`.

### Auth
| Method | Path | Auth | Body / Response |
|---|---|---|---|
| POST | `/auth/apple` | — | `{ identityToken, fullName?, email? }` → `{ token, expiresIn, user, isNewUser }` |
| GET | `/auth/me` | JWT | → `{ user }` |

New users automatically receive 10 free credits on first sign-in, inside the same DB transaction as user creation.

### Generate
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/generate` | JWT | `multipart/form-data` (with image) or `application/json` (text only) |

Request fields: `prompt` (string, required), `image` (file, optional).
Response: `{ imageUrl, creditsRemaining, generationId }`.

Mode is **auto-detected** from whether a file is attached — no `type` field needed from the client.

### Users
| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/users/me` | JWT | Returns profile + credit balance + active subscription |
| GET | `/users/me/history` | JWT | Query: `page`, `limit` (max 50). Returns paginated generations. |

### Subscriptions
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/subscriptions/storekit/verify` | JWT | Body: `{ signedTransaction }` (JWSTransaction from StoreKit 2) |
| POST | `/subscriptions/stripe/webhook` | Stripe sig | Raw body required — wired in app.js before JSON parser |
| GET | `/subscriptions/current` | JWT | Returns active subscription or null |

### Admin
All admin routes require `X-Admin-Key: <ADMIN_SECRET_KEY>` header (or `?key=` query param for the dashboard URL).

| Method | Path | Returns |
|---|---|---|
| GET | `/admin` | Dashboard HTML UI |
| GET | `/admin/api/stats` | `{ totalUsers, totalGenerations, generationsToday, activeSubscriptions, proUsers, ultraUsers, estimatedMrr }` |
| GET | `/admin/api/users` | Paginated user list with credit balance + generation count |
| GET | `/admin/api/users/:id` | Full user detail: profile, ledger, generations, subscriptions |
| GET | `/admin/api/generations` | Paginated generation list |

### Health
`GET /health` — unauthenticated, used by Railway and uptime monitors.

---

## Rate Limits

| Scope | Limit | Window |
|---|---|---|
| Global (all routes) | 200 requests | per 15 min per IP |
| Auth endpoints | 20 requests | per 15 min per IP |
| `/generate` | 10 requests | per 1 min per user ID |

---

## API Integrations

### SiliconFlow — Image Generation
- Base URL: `https://api.siliconflow.cn/v1`
- Endpoint: `POST /images/generations`
- Model: `Pro/black-forest-labs/FLUX.1-Kontext-pro` (single model for everything)
- Parameters: `image_size: 1024x1024`, `num_inference_steps: 28`, `guidance_scale: 2.5`, `batch_size: 1`
- Text-to-image: no `image` field in body
- Image-to-image: `image` field = publicly accessible URL of reference image (1-hour R2 presigned URL)
- Cost: ~$0.04/generation
- API key env var: `SILICONFLOW_API_KEY`

### Cloudflare R2 — Image Storage
- S3-compatible API via `@aws-sdk/client-s3`
- Object layout:
  - `generations/{userId}/{generationId}.png` — final generated images
  - `references/{userId}/{generationId}_ref.{ext}` — input reference images (image-to-image)
- URLs: uses public CDN URL (`R2_PUBLIC_URL`) if configured, otherwise 24-hour presigned GET URLs
- Reference images use 1-hour presigned URLs (just long enough for SiliconFlow to fetch during inference)
- Env vars: `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_URL`

### Apple Sign-In — Authentication
- iOS app calls Apple Sign-In → gets `identityToken` (JWS)
- Backend verifies token against Apple's JWKS at `https://appleid.apple.com/auth/keys`
- Uses `jwks-rsa` with 24-hour key cache
- Validates: RS256 algorithm, issuer = `https://appleid.apple.com`, audience = `APPLE_APP_BUNDLE_ID`
- Extracts `sub` claim as the stable Apple user ID
- Issues our own 30-day JWT on success
- Env var: `APPLE_APP_BUNDLE_ID`

### StoreKit 2 — iOS In-App Purchases
- App sends `signedTransaction` (JWSTransaction from StoreKit 2) to `POST /subscriptions/storekit/verify`
- Backend verifies JWS against Apple's JWKS (same `jwks-rsa` client, ES256)
- Extracts `productId`, `originalTransactionId`, `expiresDate`, `purchaseDate`
- Maps product ID → tier via `STOREKIT_PRODUCT_PRO` / `STOREKIT_PRODUCT_ULTRA` env vars
- On new subscription: creates subscription record + upgrades user tier + tops up 50 credits
- On renewal: updates period dates + tops up 50 credits again
- Env vars: `STOREKIT_PRODUCT_PRO`, `STOREKIT_PRODUCT_ULTRA`

### Stripe — Server-Side Billing
- Webhook at `POST /subscriptions/stripe/webhook` (raw body, verified with `stripe-signature` header)
- Handled events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`
- `invoice.payment_succeeded` with `billing_reason = subscription_cycle` triggers monthly credit top-up (50 credits)
- User lookup from Stripe customer metadata (`userId` field set at customer creation)
- Price ID → tier mapping via `STRIPE_PRICE_PRO` / `STRIPE_PRICE_ULTRA` env vars
- Env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ULTRA`

---

## Environment Variables (Full List)

```
NODE_ENV                              development | production
PORT                                  3000

DATABASE_URL                          PostgreSQL connection string (Supabase)
                                      Use Transaction pooler URL on Railway (port 6543)

JWT_SECRET                            64-byte hex secret
JWT_EXPIRES_IN                        30d

APPLE_APP_BUNDLE_ID                   com.yourcompany.gcimageai

R2_ENDPOINT                           https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_BUCKET_NAME                        gc-imageai-images
R2_ACCESS_KEY_ID                      Cloudflare R2 API token access key
R2_SECRET_ACCESS_KEY                  Cloudflare R2 API token secret
R2_PUBLIC_URL                         Optional CDN domain (e.g. https://images.yourdomain.com)

SILICONFLOW_API_KEY                   sk-...

STRIPE_SECRET_KEY                     sk_test_... or sk_live_...
STRIPE_WEBHOOK_SECRET                 whsec_...
STRIPE_PRICE_PRO                      price_...
STRIPE_PRICE_ULTRA                    price_...

STOREKIT_PRODUCT_PRO                  com.yourcompany.gcimageai.pro_monthly
STOREKIT_PRODUCT_ULTRA                com.yourcompany.gcimageai.ultra_monthly

ADMIN_SECRET_KEY                      32-byte hex secret
CORS_ORIGIN                           * in dev, restrict in prod
```

---

## Key Decisions Made

### Single model for all generation
FLUX.1-Kontext-pro handles both text-to-image (no `image` field) and image-to-image (with `image` field) from the same `/images/generations` endpoint. We dropped FLUX.1-schnell entirely. One model, one cost (~$0.04/gen), one code path.

### Mode auto-detected from file presence
`POST /generate` does not accept a `type` field. The server checks `!!req.file` — if an image was uploaded, it's image-to-image mode; otherwise text-to-image. The `type` is still stored in the DB for analytics but is never sent by the client.

### Credit ledger is append-only
The `credit_ledger` table is an immutable event log. Balance = `SUM(amount)` for a user. We never UPDATE or DELETE rows. This gives a full audit trail and makes balance calculation trivially correct.

### Credits only debited on success
The generation flow is: check balance → create pending record → call SiliconFlow → upload to R2 → atomically debit + mark completed. If SiliconFlow or R2 fails, the generation is marked `failed` and no credits are deducted. The debit and status update share a single DB transaction.

### Stripe webhook returns 200 even on handler errors
If a Stripe event handler throws, we log it but still return HTTP 200. This prevents Stripe from retrying indefinitely for errors that won't self-resolve (e.g. user not found). Permanent failures go to logs for manual investigation.

### StoreKit 2 only (not legacy receipts)
The app is built fresh on Swift 5.9 so we use StoreKit 2's JWSTransaction verification, not the older `verifyReceipt` endpoint. Backend verifies the JWS using Apple's JWKS (ES256).

### Admin dashboard is inline HTML
The admin dashboard is a single dark-themed HTML page rendered directly from `src/routes/admin.js` as a template string. No separate frontend build. It loads stats and tables dynamically via fetch against `/admin/api/*`. Protected by `ADMIN_SECRET_KEY` via `X-Admin-Key` header or `?key=` query param.

### Reference images uploaded to R2 before inference
For image-to-image, the client uploads the reference image in the multipart request body. The server stores it in R2 under `references/` and generates a 1-hour presigned URL to pass to SiliconFlow. SiliconFlow fetches the image from that URL during inference.

### JWT injected at request time in SiliconFlow client
The `axios` instance for SiliconFlow uses a request interceptor to inject the API key header at call time rather than at module initialisation. This means tests can set `process.env.SILICONFLOW_API_KEY` after `require()` and the correct value will be used.

---

## Local Dev Commands

```bash
npm install          # install dependencies
npm run migrate      # apply database migrations
npm run dev          # start with nodemon (auto-restart)
npm start            # start without auto-restart (production)

# Forward Stripe webhooks to local server
stripe listen --forward-to localhost:3000/subscriptions/stripe/webhook

# Access admin dashboard
open http://localhost:3000/admin?key=<ADMIN_SECRET_KEY>
```

---

## What To Work On Next

**Phase 2 — iMessage Extension (Xcode)**

1. Create Xcode project: parent app target + Messages Extension target
2. Swift networking layer: `APIClient` with Keychain JWT storage, `POST /generate` (multipart + JSON), `GET /users/me`
3. Extension main view: prompt input, image picker (Ultra only gated client-side), Generate button, loading state, result preview
4. Insert to compose: download image → `MSConversation.insertAttachment` or `MSMessage` with image layout
5. Apple Sign-In: minimal flow inside extension to exchange identity token for JWT and store in Keychain

iOS bundle ID must match `APPLE_APP_BUNDLE_ID` on the backend exactly.
