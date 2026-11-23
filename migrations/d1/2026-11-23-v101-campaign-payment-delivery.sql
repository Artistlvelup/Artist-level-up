-- V101 campaign payment and platform-delivery records.
-- Additive only: existing promotions and payment_transactions remain unchanged.
CREATE TABLE IF NOT EXISTS promotion_orders (
  id TEXT PRIMARY KEY NOT NULL,
  promotion_id TEXT NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  package_key TEXT NOT NULL CHECK (package_key IN ('starter_google_youtube','growth_google','growth_youtube','growth_tiktok','growth_all_three')),
  platforms_json TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  total_amount_ngn REAL NOT NULL CHECK (total_amount_ngn > 0),
  ad_spend_ngn REAL NOT NULL CHECK (ad_spend_ngn >= 0),
  platform_fee_ngn REAL NOT NULL CHECK (platform_fee_ngn >= 0),
  tax_ngn REAL NOT NULL DEFAULT 0 CHECK (tax_ngn >= 0),
  maintenance_ngn REAL NOT NULL DEFAULT 0 CHECK (maintenance_ngn >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled','refunded')),
  payment_reference TEXT UNIQUE,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_promotion_orders_user_created ON promotion_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_promotion_orders_promotion ON promotion_orders(promotion_id);
CREATE TABLE IF NOT EXISTS promotion_deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES promotion_orders(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('google_ads','youtube_ads','tiktok_ads')),
  provider_customer_id TEXT,
  provider_campaign_id TEXT,
  status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment','queued','paused','active','failed','completed','cancelled')),
  response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(order_id, platform)
);
CREATE INDEX IF NOT EXISTS idx_promotion_deliveries_status ON promotion_deliveries(status, updated_at DESC);
