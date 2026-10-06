BEGIN;

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    plant_id INTEGER,
    type VARCHAR(32) NOT NULL
        CHECK (type IN ('watering_due', 'watering_day_before', 'morning_summary')),
    title VARCHAR(120) NOT NULL,
    body VARCHAR(1000) NOT NULL,
    url VARCHAR(2048) NOT NULL DEFAULT '/home',
    dedupe_key VARCHAR(255) NOT NULL,
    scheduled_for TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
    ON notifications (user_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
    ON notifications (user_id, read_at);

COMMIT;
