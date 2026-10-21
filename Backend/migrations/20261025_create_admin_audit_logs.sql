
BEGIN;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(32),
    target_id VARCHAR(64),
    payload JSONB,
    ip INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
    ON admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_admin_created
    ON admin_audit_logs (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target
    ON admin_audit_logs (target_type, target_id);

CREATE OR REPLACE FUNCTION admin_audit_logs_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'UPDATE'
        AND OLD.admin_id IS NOT NULL
        AND NEW.admin_id IS NULL
        AND NEW.id = OLD.id
        AND NEW.action IS NOT DISTINCT FROM OLD.action
        AND NEW.target_type IS NOT DISTINCT FROM OLD.target_type
        AND NEW.target_id IS NOT DISTINCT FROM OLD.target_id
        AND NEW.payload IS NOT DISTINCT FROM OLD.payload
        AND NEW.ip IS NOT DISTINCT FROM OLD.ip
        AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
        AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
        AND pg_trigger_depth() > 1
    THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE'
        AND current_setting('webplant.admin_audit_purge', true) = 'on'
    THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'admin_audit_logs is append-only';
END;
$function$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_admin_audit_logs_append_only'
          AND tgrelid = 'public.admin_audit_logs'::regclass
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER trg_admin_audit_logs_append_only
            BEFORE UPDATE OR DELETE ON public.admin_audit_logs
            FOR EACH ROW
            EXECUTE FUNCTION public.admin_audit_logs_append_only();
    END IF;
END $$;

CREATE OR REPLACE FUNCTION purge_admin_audit_logs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
    deleted integer;
BEGIN
    PERFORM set_config('webplant.admin_audit_purge', 'on', true);

    DELETE FROM public.admin_audit_logs
    WHERE created_at < now() - interval '365 days';

    GET DIAGNOSTICS deleted = ROW_COUNT;

    PERFORM set_config('webplant.admin_audit_purge', 'off', true);

    RETURN deleted;
END;
$function$;

REVOKE ALL ON FUNCTION purge_admin_audit_logs() FROM PUBLIC;

DO $$
DECLARE
    owner_role text;
BEGIN
    SELECT pg_get_userbyid(c.relowner)
    INTO owner_role
    FROM pg_class c
    WHERE c.oid = 'public.admin_audit_logs'::regclass;

    IF owner_role IS NOT NULL THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.purge_admin_audit_logs() TO %I', owner_role);
    END IF;

    IF current_user <> owner_role THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.purge_admin_audit_logs() TO %I', current_user);
    END IF;
END $$;

REVOKE UPDATE, DELETE ON admin_audit_logs FROM PUBLIC;

COMMENT ON TABLE admin_audit_logs IS
    'Аудит действий администратора. Append-only; ретенция 365 дней через purge_admin_audit_logs().';
COMMENT ON FUNCTION purge_admin_audit_logs() IS
    'Удаляет записи admin_audit_logs старше 365 дней. Единственный разрешённый путь DELETE.';

COMMIT;
