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
- All IAP handled by RevenueCat (iOS SDK + backend REST API). No custom StoreKit or Stripe code.

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
| Payments (iOS + server) | RevenueCat (SDK + REST API) |
| Hosting | Railway |

---

## Development Phases

### Phase 1 — Backend (COMPLETE)
Full Node.js + Express API. See details below.
RevenueCat integrated for all subscription and IAP handling. Stripe and raw StoreKit code removed.

### Phase 2 — iMessage Extension (IN PROGRESS — SCAFFOLD COMPLETE)
Xcode project scaffolded at `GCImageAI/`. Generated via XcodeGen 2.45.3.

**Targets:**
- `GCImageAI` — parent SwiftUI app (iOS 17+)
- `GCImageAIMessages` — iMessage App Extension (MSMessagesAppViewController)
- `Shared/` — shared Swift files compiled into both targets (no framework)

**What's built:**
- ✅ `Shared/Models.swift` — User, UserTier, GenerationResponse, MeResponse, AuthResponse, APIError
- ✅ `Shared/Keychain.swift` — save/load/delete JWT and userId in Keychain (shared access group)
- ✅ `Shared/APIClient.swift` — full networking layer: appleSignIn, getMe, generate (text + multipart), syncSubscription, history
- ✅ `Shared/AuthManager.swift` — ObservableObject, Apple Sign-In delegate, Keychain persistence
- ✅ `GCImageAI/GCImageAIApp.swift` — RevenueCat configure + logIn on launch
- ✅ `GCImageAI/SignInView.swift` — SwiftUI Apple Sign-In screen
- ✅ `GCImageAI/ContentView.swift` — TabView (Account + History tabs)
- ✅ `GCImageAI/AccountView.swift` — profile, credits, subscription, sign out
- ✅ `GCImageAI/HistoryView.swift` — 2-column grid of past generations
- ✅ `GCImageAIMessages/MessagesViewController.swift` — MSMessagesAppViewController; routes to sign-in or generator
- ✅ `GCImageAIMessages/GeneratorViewController.swift` — UIKit host for GeneratorView; downloads image and inserts attachment into MSConversation
- ✅ `GCImageAIMessages/GeneratorView.swift` — SwiftUI: prompt input, PhotosPicker (Ultra only), Generate button, credit counter
- ✅ `GCImageAIMessages/ExtensionSignInViewController.swift` — UIKit Apple Sign-In inside extension
- ✅ `project.yml` — XcodeGen spec; RevenueCat SPM dependency; entitlements; keychain-access-groups
- ✅ `GCImageAI.xcodeproj` — generated, ready to open in Xcode

**What's left for Phase 2:**
- ⏳ Apple Developer Program membership — enrollment submitted, pending activation (can take up to 48 hours)
- [ ] Once membership activates: register bundle IDs in Apple Developer portal
  - `com.michaelmannino.gcimageai` (app)
  - `com.michaelmannino.gcimageai.messages` (iMessage extension)
- [ ] Enable iMessage App capability for `com.michaelmannino.gcimageai` in the portal
- [ ] Open `GCImageAI/GCImageAI.xcodeproj` in Xcode, set Development Team in Signing & Capabilities for both targets
- [ ] Run on device or simulator to test sign-in + generation flow end to end
- [ ] Replace `localhost:3000` baseURL with Railway production URL before TestFlight

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

## iOS — File Structure

```
GCImageAI/
├── project.yml                             XcodeGen spec (source of truth for .xcodeproj)
├── GCImageAI.xcodeproj                     Generated — open this in Xcode
├── Shared/                                 Compiled into BOTH targets
│   ├── Models.swift                        User, Generation, MeResponse, AuthResponse, APIError
│   ├── Keychain.swift                      JWT + userId stored in shared Keychain group
│   ├── APIClient.swift                     All backend calls; baseURL switches DEBUG/prod
│   └── AuthManager.swift                  ObservableObject; Apple Sign-In delegate
├── GCImageAI/                              Parent app target
│   ├── GCImageAIApp.swift                  @main; RC configure + logIn
│   ├── SignInView.swift                    SwiftUI Apple Sign-In onboarding
│   ├── ContentView.swift                   TabView (Account + History)
│   ├── AccountView.swift                   Profile, credits, subscription, sign out
│   ├── HistoryView.swift                   2-col grid of past generations
│   ├── GCImageAI.entitlements             Apple Sign-In + keychain-access-groups
│   └── Assets.xcassets/
├── GCImageAIMessages/                      iMessage extension target
│   ├── MessagesViewController.swift        MSMessagesAppViewController entry point
│   ├── GeneratorViewController.swift       UIKit host; MSConversation.insertAttachment
│   ├── GeneratorView.swift                 SwiftUI: prompt + image picker + generate
│   ├── ExtensionSignInViewController.swift UIKit Apple Sign-In (extension context)
│   ├── GCImageAIMessages.entitlements     Shared keychain-access-groups
│   └── Assets.xcassets/
```

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
│   │   ├── subscriptions.js          POST /subscriptions/revenuecat/sync
│   │   │                             POST /subscriptions/revenuecat/webhook
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
│       ├── revenueCat.js             getSubscriberInfo, syncSubscriberTier, verifyWebhookAuth
│       └── siliconFlow.js            generateImage(prompt, referenceImageUrl?)
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
One row per user — upserted on each RevenueCat webhook or sync call. RC is the source of truth; this is a cache for fast reads.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK → users UNIQUE | One subscription record per user |
| tier | ENUM | `pro` / `ultra` |
| status | ENUM | `active` / `cancelled` / `expired` / `past_due` |
| entitlement | VARCHAR | RC entitlement identifier: `pro` or `ultra` |
| revenuecat_product_id | VARCHAR | Product ID from RC event |
| expires_date | TIMESTAMPTZ | When the current period ends |
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
| POST | `/subscriptions/revenuecat/sync` | JWT | Called by iOS app after purchase; pulls latest state from RC REST API |
| POST | `/subscriptions/revenuecat/webhook` | RC secret | Receives real-time events from RevenueCat |
| GET | `/subscriptions/current` | JWT | Returns cached subscription record from DB |

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

### RevenueCat — All Subscription & IAP Handling
RevenueCat replaces all custom Stripe and StoreKit code. It handles receipt validation with Apple, subscription lifecycle, and renewals.

**iOS SDK** (Phase 2):
- `Purchases.configure(withAPIKey: "test_DSVjgvqfgizAaTiaIsfcgzqzcua")` on app launch
- `Purchases.shared.logIn(appUserID: user.id)` immediately after Apple Sign-In — this links purchases to our user UUID
- After a purchase completes, call `POST /subscriptions/revenuecat/sync` to update the backend

**Backend REST API** (`src/services/revenueCat.js`):
- Base URL: `https://api.revenuecat.com/v1`
- `GET /subscribers/{userId}` — fetch subscriber info; our user UUID is the RC app user ID
- `syncSubscriberTier(userId)` — calls RC, updates `users.tier` + `subscriptions` table if changed, returns authoritative tier
- Called on every `POST /generate` request so stale subscription state is never acted on

**Webhooks** (`POST /subscriptions/revenuecat/webhook`):
- Authenticated via `Authorization` header matching `REVENUECAT_WEBHOOK_SECRET`
- Webhook URL to configure in RC dashboard: `https://your-domain.com/subscriptions/revenuecat/webhook`
- Handled events:

| Event | Action |
|---|---|
| `INITIAL_PURCHASE` | Upgrade tier + top up 50 credits (atomic transaction) |
| `RENEWAL` | Refresh `expires_date` + top up 50 credits |
| `PRODUCT_CHANGE` | Update tier |
| `CANCELLATION` | Mark subscription `cancelled` (tier stays until expiry) |
| `UNCANCELLATION` | Mark subscription `active` |
| `EXPIRATION` | Mark `expired` + downgrade user to `free` |
| `BILLING_ISSUE` | Mark `past_due` |

**Entitlements** (must match RC dashboard configuration):
- `pro` → Pro tier ($6.99/month)
- `ultra` → Ultra tier ($12.99/month)

**Env vars**: `REVENUECAT_SECRET_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_ENTITLEMENT_PRO`, `REVENUECAT_ENTITLEMENT_ULTRA`

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

REVENUECAT_SECRET_KEY                 sk_... (from RC Dashboard → API Keys → Secret keys)
REVENUECAT_WEBHOOK_SECRET             random string — set same value in RC Dashboard → Webhooks
REVENUECAT_ENTITLEMENT_PRO            pro
REVENUECAT_ENTITLEMENT_ULTRA          ultra
# Note: RC public API key (test_DSVjgvqfgizAaTiaIsfcgzqzcua) goes in the iOS app, not here

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

### RevenueCat handles all subscription and IAP logic
Custom StoreKit and Stripe subscription code has been removed entirely. RevenueCat is the single source of truth for subscription state. The backend uses RC's REST API to verify tier before every generation request (`syncSubscriberTier`), and RC webhooks keep the DB in sync for lifecycle events (purchase, renewal, expiry, etc.). The `stripe` npm package has been removed from the project.

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

**RevenueCat setup checklist before testing Phase 2:**
- [ ] Create entitlements named exactly `pro` and `ultra` in RC dashboard
- [ ] Attach App Store products to each entitlement
- [ ] Configure webhook URL: `https://your-domain/subscriptions/revenuecat/webhook`
- [ ] Set a webhook secret in RC dashboard and add to `REVENUECAT_WEBHOOK_SECRET` in `.env`
- [ ] iOS SDK: `Purchases.configure(withAPIKey: "test_DSVjgvqfgizAaTiaIsfcgzqzcua")` on launch
- [ ] iOS SDK: `Purchases.shared.logIn(appUserID: user.id)` after sign-in
