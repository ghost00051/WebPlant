BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS marketing_email_opt_in BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS marketing_email_opt_in_at TIMESTAMPTZ;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS marketing_email_opt_in_source VARCHAR(32);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS marketing_email_opt_out_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_marketing_email_opt_in
    ON users (marketing_email_opt_in)
    WHERE marketing_email_opt_in = TRUE;

COMMIT;
