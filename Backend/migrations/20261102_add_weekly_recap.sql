BEGIN;

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS weekly_recap_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS last_weekly_recap_date DATE;

INSERT INTO notification_preferences (user_id, weekly_recap_enabled, created_at, updated_at)
SELECT users.id, TRUE, now(), now()
FROM users
WHERE NOT EXISTS (
    SELECT 1
    FROM notification_preferences
    WHERE notification_preferences.user_id = users.id
);

DO $$
DECLARE
    existing_constraint text;
BEGIN
    FOR existing_constraint IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'notifications'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%watering_due%'
    LOOP
        EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', existing_constraint);
    END LOOP;
END $$;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
        'watering_due',
        'watering_day_before',
        'morning_summary',
        'care_reminder',
        'care_tip',
        'weekly_recap'
    ));

CREATE INDEX IF NOT EXISTS idx_notifications_type_created
    ON notifications (type, created_at DESC);

COMMIT;
