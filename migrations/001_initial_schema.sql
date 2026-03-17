-- GC ImageAI — Initial Database Schema
-- Run via: node scripts/migrate.js

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Enum Types
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_tier AS ENUM ('free', 'pro', 'ultra');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE generation_type AS ENUM ('text_to_image', 'image_to_image');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE generation_status AS ENUM ('pending', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('active', 'cancelled', 'expired', 'past_due');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE credit_reason AS ENUM (
    'signup_bonus',
    'subscription_topup',
    'generation_use',
    'admin_grant',
    'refund'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  apple_user_id     VARCHAR(255)  UNIQUE NOT NULL,
  email             VARCHAR(255),
  full_name         VARCHAR(255),
  tier              user_tier     NOT NULL DEFAULT 'free',
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Generations
-- (Created before credit_ledger so credit_ledger can FK reference it)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generations (
  id            UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID              NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt        TEXT              NOT NULL,
  type          generation_type   NOT NULL DEFAULT 'text_to_image',
  status        generation_status NOT NULL DEFAULT 'pending',
  image_url     TEXT,
  r2_key        TEXT,
  credits_used  INTEGER           NOT NULL DEFAULT 1,
  model         VARCHAR(255),
  metadata      JSONB             NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Credit Ledger  (append-only event log — never UPDATE/DELETE rows)
-- Positive amount = credit in, Negative = credit out
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_ledger (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          INTEGER       NOT NULL,
  reason          credit_reason NOT NULL,
  generation_id   UUID          REFERENCES generations(id) ON DELETE SET NULL,
  metadata        JSONB         NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Subscriptions
-- Managed entirely by RevenueCat. One row per user (upserted on each event).
-- RevenueCat is the source of truth; this table is a cache for fast reads.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id                    UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID                NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tier                  user_tier           NOT NULL,
  status                subscription_status NOT NULL DEFAULT 'active',
  entitlement           VARCHAR(100),        -- RC entitlement identifier: 'pro' or 'ultra'
  revenuecat_product_id VARCHAR(255),        -- product_id from RC event/subscriber
  expires_date          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_apple_id
  ON users(apple_user_id);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_id
  ON credit_ledger(user_id);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_created_at
  ON credit_ledger(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generations_user_id
  ON generations(user_id);

CREATE INDEX IF NOT EXISTS idx_generations_created_at
  ON generations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generations_status
  ON generations(status);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
  ON subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON subscriptions(status);

-- ---------------------------------------------------------------------------
-- updated_at auto-trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
