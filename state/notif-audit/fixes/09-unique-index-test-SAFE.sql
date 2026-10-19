BEGIN;

DO $do$
DECLARE
  probe_key text := 'tx-probe-' || md5(random()::text);
  remaining int;
BEGIN
  INSERT INTO push_broadcasts (title, body, target_mode, status, idempotency_key)
  VALUES ('tx-probe', 'tx-probe', 'all', 'pending', probe_key);

  BEGIN
    INSERT INTO push_broadcasts (title, body, target_mode, status, idempotency_key)
    VALUES ('tx-probe', 'tx-probe', 'all', 'pending', probe_key);
    RAISE EXCEPTION 'unique index NOT enforced';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'unique index OK (key=%)', probe_key;
  END;

  SELECT count(*) INTO remaining FROM push_broadcasts WHERE idempotency_key = probe_key;
  RAISE NOTICE 'trace_rows_inside_tx=%', remaining;
END $do$;

ROLLBACK;

SELECT 'trace_rows_after_rollback=' || count(*)
FROM push_broadcasts WHERE idempotency_key LIKE 'tx-probe-%';

SELECT 'pending_or_sending_now=' || count(*)
FROM push_broadcasts WHERE status IN ('pending', 'sending');
