BEGIN;

CREATE TABLE IF NOT EXISTS plant_photos (
    id SERIAL PRIMARY KEY,
    plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_main BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plant_photos_plant
    ON plant_photos (plant_id);

CREATE INDEX IF NOT EXISTS idx_plant_photos_sort
    ON plant_photos (plant_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_plant_photos_main
    ON plant_photos (plant_id, is_main)
    WHERE is_main = TRUE;

ALTER TABLE plant_photos
    ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;

ALTER TABLE plant_photos
    ADD COLUMN IF NOT EXISTS note TEXT;

CREATE INDEX IF NOT EXISTS idx_plant_photos_taken
    ON plant_photos (plant_id, taken_at DESC NULLS LAST);

COMMIT;
