BEGIN;

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
    morning_summary_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    dark_theme_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    theme_mode VARCHAR(10) NOT NULL DEFAULT 'system'
        CHECK (theme_mode IN ('system', 'light', 'dark')),
    last_morning_summary_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS dark_theme_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE notification_preferences
    ADD COLUMN IF NOT EXISTS theme_mode VARCHAR(10);

UPDATE notification_preferences
SET theme_mode = CASE WHEN dark_theme_enabled THEN 'dark' ELSE 'light' END
WHERE theme_mode IS NULL;

ALTER TABLE notification_preferences
    ALTER COLUMN theme_mode SET DEFAULT 'system',
    ALTER COLUMN theme_mode SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'notification_preferences_theme_mode_check'
    ) THEN
        ALTER TABLE notification_preferences
            ADD CONSTRAINT notification_preferences_theme_mode_check
            CHECK (theme_mode IN ('system', 'light', 'dark'));
    END IF;
END $$;

COMMIT;
