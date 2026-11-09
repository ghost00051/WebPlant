BEGIN;

DO $$
BEGIN
    IF to_regtype('enum_ai_advice_logs_kind') IS NOT NULL THEN
        ALTER TYPE enum_ai_advice_logs_kind ADD VALUE IF NOT EXISTS 'care';
    END IF;
END $$;

DO $$
DECLARE
    existing_constraint text;
BEGIN
    SELECT conname INTO existing_constraint
    FROM pg_constraint
    WHERE conrelid = 'notifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%watering_due%';

    IF existing_constraint IS NOT NULL THEN
        EXECUTE format('ALTER TABLE notifications DROP CONSTRAINT %I', existing_constraint);
    END IF;
END $$;

DO $$
DECLARE
    violating integer;
BEGIN
    SELECT count(*) INTO violating
    FROM notifications
    WHERE type NOT IN (
        'watering_due',
        'watering_day_before',
        'morning_summary',
        'care_reminder',
        'care_tip'
    );

    IF violating > 0 THEN
        RAISE NOTICE 'notifications_type_check пропущен: % строк с другими типами, ограничение задаст 20261102_add_weekly_recap', violating;
    ELSE
        BEGIN
            ALTER TABLE notifications
                ADD CONSTRAINT notifications_type_check
                CHECK (type IN (
                    'watering_due',
                    'watering_day_before',
                    'morning_summary',
                    'care_reminder',
                    'care_tip'
                ));
        EXCEPTION
            WHEN duplicate_object THEN
                RAISE NOTICE 'notifications_type_check уже существует';
        END;
    END IF;
END $$;

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_notifications_user_type_created
    ON notifications (user_id, type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_plant_created
    ON notifications (plant_id, created_at DESC)
    WHERE plant_id IS NOT NULL;

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS care_advice_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS last_care_advice_date DATE;

INSERT INTO notification_preferences (user_id, care_advice_enabled)
SELECT users.id, TRUE
FROM users
WHERE NOT EXISTS (
    SELECT 1
    FROM notification_preferences
    WHERE notification_preferences.user_id = users.id
);

COMMIT;
