BEGIN;

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_notifications_clicked_at
    ON notifications (clicked_at)
    WHERE clicked_at IS NOT NULL;

COMMIT;
