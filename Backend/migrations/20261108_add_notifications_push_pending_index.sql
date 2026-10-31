
BEGIN;

CREATE INDEX IF NOT EXISTS idx_notifications_push_pending_created
    ON notifications (created_at)
    WHERE (payload->>'push_pending') = 'true';

COMMIT;
