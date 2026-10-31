BEGIN;

ALTER TABLE garden_shares
    ADD COLUMN IF NOT EXISTS views_notified_at TIMESTAMPTZ;

ALTER TABLE garden_shares
    ADD COLUMN IF NOT EXISTS views_notified_count INTEGER NOT NULL DEFAULT 0;

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
        'weekly_recap',
        'garden_view'
    ));

COMMIT;
