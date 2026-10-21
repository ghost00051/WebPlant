CREATE TABLE IF NOT EXISTS ai_advice_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind VARCHAR(16) NOT NULL,
    plant_name VARCHAR(255),
    species VARCHAR(255),
    season VARCHAR(16),
    result_type VARCHAR(16),
    interval_days INTEGER,
    time_of_day VARCHAR(16),
    confidence VARCHAR(16),
    questions_asked INTEGER NOT NULL DEFAULT 0,
    source VARCHAR(16) NOT NULL DEFAULT 'ai',
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_advice_logs_created
    ON ai_advice_logs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_ai_advice_logs_kind_created
    ON ai_advice_logs (kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_advice_logs_user
    ON ai_advice_logs (user_id, created_at DESC);
