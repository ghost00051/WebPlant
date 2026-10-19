BEGIN;

CREATE INDEX IF NOT EXISTS idx_notification_prefs_morning_enabled
    ON notification_preferences (user_id)
    WHERE morning_summary_enabled = TRUE;

CREATE INDEX IF NOT EXISTS idx_notification_prefs_care_enabled
    ON notification_preferences (user_id)
    WHERE care_advice_enabled = TRUE;

COMMIT;
