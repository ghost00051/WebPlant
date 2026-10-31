BEGIN;

CREATE TABLE IF NOT EXISTS plant_care_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    action_code VARCHAR(32) NOT NULL,
    product_name VARCHAR(160),
    dose VARCHAR(120),
    method VARCHAR(32),
    note VARCHAR(500),
    performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notification_id INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plant_care_log_user_time
    ON plant_care_logs (user_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_plant_care_log_plant_time
    ON plant_care_logs (plant_id, performed_at DESC);

COMMIT;
