BEGIN;

ALTER TABLE site_visit_days
    ADD COLUMN IF NOT EXISTS utm_source VARCHAR(120);

ALTER TABLE site_visit_days
    ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(120);

ALTER TABLE site_visit_days
    ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_site_visit_days_utm_source
    ON site_visit_days (utm_source)
    WHERE utm_source IS NOT NULL;

COMMIT;
