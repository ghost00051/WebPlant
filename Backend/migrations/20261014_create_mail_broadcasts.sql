BEGIN;

CREATE TABLE IF NOT EXISTS mail_broadcasts (
    id SERIAL PRIMARY KEY,
    subject VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    cta_label VARCHAR(80),
    cta_url VARCHAR(2048),
    target_mode VARCHAR(16) NOT NULL
        CHECK (target_mode IN ('all', 'users')),
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'canceled')),
    scheduled_for TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    total_recipients INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mail_broadcasts_status_scheduled
    ON mail_broadcasts (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_mail_broadcasts_created
    ON mail_broadcasts (created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS mail_broadcast_recipients (
    id SERIAL PRIMARY KEY,
    broadcast_id INTEGER NOT NULL REFERENCES mail_broadcasts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(254) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_broadcast_recipients_unique
    ON mail_broadcast_recipients (broadcast_id, user_id);
CREATE INDEX IF NOT EXISTS idx_mail_broadcast_recipients_status
    ON mail_broadcast_recipients (broadcast_id, status);

COMMIT;
