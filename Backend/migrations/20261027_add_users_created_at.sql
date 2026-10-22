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
END $$;

UPDATE users
SET created_at = now()
WHERE created_at IS NULL;

ALTER TABLE users
    ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE users
    ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_created_at
    ON users (created_at);

COMMIT;
