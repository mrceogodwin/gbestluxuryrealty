-- G-BEST homepage newsletter subscribers.
-- Apply through the approved Neon migration workflow before enabling live signups.
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  source VARCHAR(40) NOT NULL DEFAULT 'homepage',
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unsubscribed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS newsletter_subscribers_active_idx
  ON newsletter_subscribers (subscribed_at DESC)
  WHERE unsubscribed_at IS NULL;
