-- RLS de aislamiento por tenant en app_user (mismo patrón que el resto de tablas:
-- ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app_user
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Login previo a tener contexto de tenant: el mismo problema de "huevo y gallina"
-- que resolve_tenant_by_whatsapp_phone. Esta función acotada (SECURITY DEFINER,
-- la ejecuta su dueño que sí ve la fila) devuelve SOLO lo necesario para autenticar
-- y construir el JWT; el resto se opera después con RLS y el tenant ya fijado.
-- email único GLOBAL + comparación case-insensitive ⇒ login inequívoco.
CREATE OR REPLACE FUNCTION find_app_user_for_login(p_email text)
  RETURNS TABLE(
    id uuid,
    tenant_id uuid,
    password_hash text,
    role text,
    zone_paths text[],
    active boolean
  )
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
AS $$
  SELECT id, tenant_id, password_hash, role::text, zone_paths, active
  FROM app_user
  WHERE lower(email) = lower(p_email);
$$;
--> statement-breakpoint

-- Solo el rol de aplicación puede invocarla.
REVOKE EXECUTE ON FUNCTION find_app_user_for_login(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION find_app_user_for_login(text) TO app;
