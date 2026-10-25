BEGIN;

CREATE INDEX IF NOT EXISTS idx_plants_active_next_watering
    ON plants (next_watering_at)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_plants_user_active_next_watering
    ON plants (user_id, next_watering_at)
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_watering_log_user_action
    ON watering_logs (user_id, action, action_at DESC);

COMMIT;
