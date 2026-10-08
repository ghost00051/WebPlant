BEGIN;

CREATE TABLE IF NOT EXISTS push_broadcasts (
    id SERIAL PRIMARY KEY,
    title VARCHAR(120) NOT NULL,
    body VARCHAR(1000) NOT NULL,
    icon VARCHAR(2048),
    url VARCHAR(2048) NOT NULL DEFAULT '/',
    target_mode VARCHAR(16) NOT NULL
        CHECK (target_mode IN ('all', 'users')),
    include_guests BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'canceled')),
    scheduled_for TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    total_subscriptions INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    removed_count INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_push_broadcasts_status_scheduled
    ON push_broadcasts (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_push_broadcasts_created
    ON push_broadcasts (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS push_broadcast_recipients (
    id SERIAL PRIMARY KEY,
    broadcast_id INTEGER NOT NULL REFERENCES push_broadcasts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_broadcast_recipients_unique
    ON push_broadcast_recipients (broadcast_id, user_id);

COMMIT;
