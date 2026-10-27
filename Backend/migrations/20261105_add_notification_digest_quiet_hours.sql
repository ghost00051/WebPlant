BEGIN;

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(16);

UPDATE notification_preferences
SET delivery_mode = 'digest'
WHERE delivery_mode IS NULL;

ALTER TABLE notification_preferences
    ALTER COLUMN delivery_mode SET DEFAULT 'digest',
    ALTER COLUMN delivery_mode SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'notification_preferences_delivery_mode_check'
    ) THEN
        ALTER TABLE notification_preferences
            ADD CONSTRAINT notification_preferences_delivery_mode_check
            CHECK (delivery_mode IN ('digest', 'per_plant'));
    END IF;
END $$;

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS quiet_hours_start VARCHAR(5);

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS quiet_hours_end VARCHAR(5);

UPDATE notification_preferences
SET quiet_hours_start = '22:00'
WHERE quiet_hours_start IS NULL;

UPDATE notification_preferences
SET quiet_hours_end = '08:00'
WHERE quiet_hours_end IS NULL;

ALTER TABLE notification_preferences
    ALTER COLUMN quiet_hours_start SET DEFAULT '22:00',
    ALTER COLUMN quiet_hours_start SET NOT NULL,
    ALTER COLUMN quiet_hours_end SET DEFAULT '08:00',
    ALTER COLUMN quiet_hours_end SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'notification_preferences_quiet_hours_start_check'
    ) THEN
        ALTER TABLE notification_preferences
            ADD CONSTRAINT notification_preferences_quiet_hours_start_check
            CHECK (quiet_hours_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'notification_preferences_quiet_hours_end_check'
    ) THEN
        ALTER TABLE notification_preferences
            ADD CONSTRAINT notification_preferences_quiet_hours_end_check
            CHECK (quiet_hours_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
    END IF;
END $$;

COMMIT;
