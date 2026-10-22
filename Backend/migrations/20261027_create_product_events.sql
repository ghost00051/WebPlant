BEGIN;

CREATE TABLE IF NOT EXISTS product_events (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visitor_id VARCHAR(64),
    event VARCHAR(64) NOT NULL,
    properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    path VARCHAR(300),
    referrer_host VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_events_created_at
    ON product_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_events_user_created
    ON product_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_events_event_created
    ON product_events (event, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_events_visitor_created
    ON product_events (visitor_id, created_at DESC);

COMMIT;
