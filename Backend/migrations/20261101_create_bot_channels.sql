BEGIN;


CREATE TABLE IF NOT EXISTS bot_links (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(16) NOT NULL,
    external_user_id VARCHAR(64) NOT NULL,
    username VARCHAR(128),
    display_name VARCHAR(128),
    notifications_enabled BOOLEAN NOT NULL DEFAULT true,
    is_active BOOLEAN NOT NULL DEFAULT true,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    unlinked_at TIMESTAMPTZ,
    last_inbound_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_links_channel_external
    ON bot_links (channel, external_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_links_user_channel_active
    ON bot_links (user_id, channel)
    WHERE is_active;

CREATE INDEX IF NOT EXISTS idx_bot_links_channel_active
    ON bot_links (channel, is_active);

CREATE INDEX IF NOT EXISTS idx_bot_links_user_active
    ON bot_links (user_id, is_active);

CREATE TABLE IF NOT EXISTS bot_link_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(64) UNIQUE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(16) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_link_codes_code
    ON bot_link_codes (code);

CREATE INDEX IF NOT EXISTS idx_bot_link_codes_user_channel
    ON bot_link_codes (user_id, channel);

CREATE TABLE IF NOT EXISTS bot_messages (
    id BIGSERIAL PRIMARY KEY,
    channel VARCHAR(16) NOT NULL,
    direction VARCHAR(8) NOT NULL DEFAULT 'out',
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    bot_link_id INTEGER REFERENCES bot_links(id) ON DELETE SET NULL,
    external_user_id VARCHAR(64),
    notification_id INTEGER REFERENCES notifications(id) ON DELETE SET NULL,
    kind VARCHAR(32),
    status VARCHAR(16) NOT NULL,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 1,
    latency_ms INTEGER,
    command VARCHAR(64),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bot_messages_channel_created
    ON bot_messages (channel, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_messages_user_created
    ON bot_messages (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_messages_status_created
    ON bot_messages (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_messages_kind_created
    ON bot_messages (kind, created_at DESC);

COMMIT;
