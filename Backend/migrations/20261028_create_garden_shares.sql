BEGIN;

CREATE TABLE IF NOT EXISTS garden_shares (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    view_count INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_garden_shares_token
    ON garden_shares (token);

WITH ranked AS (
    SELECT id,
           row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
    FROM garden_shares
    WHERE revoked_at IS NULL
)
UPDATE garden_shares gs
SET revoked_at = now()
FROM ranked r
WHERE gs.id = r.id
  AND r.rn > 1;

DROP INDEX IF EXISTS idx_garden_shares_active_user;

CREATE UNIQUE INDEX IF NOT EXISTS idx_garden_shares_active_user
    ON garden_shares (user_id)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS garden_share_signups (
    id SERIAL PRIMARY KEY,
    share_id INTEGER NOT NULL REFERENCES garden_shares(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_garden_share_signups_share
    ON garden_share_signups (share_id);

CREATE INDEX IF NOT EXISTS idx_garden_share_signups_created
    ON garden_share_signups (created_at);

COMMIT;
