BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS inactivity_email_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN users.inactivity_email_sent_at IS
    'Когда отправлено письмо «Всё в порядке?» (NULL — ещё не отправляли). Атомарный claim перед отправкой, при ошибке откатывается.';

CREATE INDEX IF NOT EXISTS idx_users_inactivity_email_sent_at
    ON users (inactivity_email_sent_at)
    WHERE inactivity_email_sent_at IS NULL;

COMMIT;
