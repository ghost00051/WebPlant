
BEGIN;

ALTER TABLE push_subscriptions
    ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_error TEXT,
    ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS invalid_reason VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_invalidated_at
    ON push_subscriptions (invalidated_at)
    WHERE invalidated_at IS NOT NULL;

ALTER TABLE push_broadcasts
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(200),
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_processed_id INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS chunk_size INTEGER NOT NULL DEFAULT 200;

CREATE UNIQUE INDEX IF NOT EXISTS idx_push_broadcasts_idempotency
    ON push_broadcasts (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_push_broadcasts_status_updated
    ON push_broadcasts (status, updated_at);

ALTER TABLE push_broadcast_recipients
    ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_push_broadcast_recipients_status
    ON push_broadcast_recipients (broadcast_id, status);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'push_broadcast_recipients_status_check'
    ) THEN
        ALTER TABLE push_broadcast_recipients
            ADD CONSTRAINT push_broadcast_recipients_status_check
            CHECK (status IN ('pending', 'sent', 'failed'));
    END IF;
END $$;

COMMIT;
