-- Журнал запусков бэкапа.
-- Пишут двое: host-контейнер ctp_backup (source = 'host') и CronJob db-backup в кластере
-- (source = 'cluster'). Админка читает таблицу и считает обратный отсчёт до следующего запуска.

BEGIN;

CREATE TABLE IF NOT EXISTS backup_runs (
    id BIGSERIAL PRIMARY KEY,
    source VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    database_bytes BIGINT,
    uploads_bytes BIGINT,
    files JSONB,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_backup_runs_finished_at
    ON backup_runs (finished_at DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS idx_backup_runs_source_finished
    ON backup_runs (source, finished_at DESC NULLS LAST);

COMMENT ON TABLE backup_runs IS
    'Журнал запусков бэкапа БД. Ретенция 180 дней, чистится при каждой записи.';
COMMENT ON COLUMN backup_runs.source IS
    'host — ctp_backup на хосте, cluster — CronJob db-backup в кластере';
COMMENT ON COLUMN backup_runs.status IS
    'ok — дамп снят и проверен pg_restore --list, failed — ошибка';

COMMIT;
