
BEGIN;


ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

DO $$
BEGIN
    IF to_regclass('public.user_legal_consents') IS NOT NULL THEN
        EXECUTE $update$
            UPDATE users u
            SET created_at = (
                SELECT MIN(lc.accepted_at)
                FROM user_legal_consents lc
                WHERE lc.user_id = u.id
                  AND lc.source = 'registration'
            )
            WHERE u.created_at IS NULL
        $update$;
    END IF;

    IF to_regclass('public.auth_sessions') IS NOT NULL THEN
        EXECUTE $update$
            UPDATE users u
            SET created_at = (
                SELECT MIN(s.created_at)
                FROM auth_sessions s
                WHERE s.user_id = u.id
            )
            WHERE u.created_at IS NULL
        $update$;
    END IF;
END $$;

UPDATE users
SET created_at = CURRENT_TIMESTAMP
WHERE created_at IS NULL;

ALTER TABLE users
    ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE users
    ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_created_at
    ON users (created_at);


CREATE TABLE IF NOT EXISTS site_visit_days (
    id SERIAL PRIMARY KEY,
    visitor_id VARCHAR(64) NOT NULL,
    day DATE NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    views INTEGER NOT NULL DEFAULT 1,
    first_path VARCHAR(300),
    referrer_host VARCHAR(255),
    device VARCHAR(16),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_visit_days_visitor_day
    ON site_visit_days (visitor_id, day);
CREATE INDEX IF NOT EXISTS idx_site_visit_days_day
    ON site_visit_days (day DESC);
CREATE INDEX IF NOT EXISTS idx_site_visit_days_user
    ON site_visit_days (user_id, day DESC);

COMMIT;
