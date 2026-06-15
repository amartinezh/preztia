-- RLS de aislamiento por tenant en collector_client (mismo patrón que el resto de
-- tablas: ENABLE + FORCE + POLICY tenant_isolation). El alcance por cliente (qué
-- cobrador ve qué deudor) es authZ de aplicación; RLS solo garantiza el aislamiento
-- entre tenants.
ALTER TABLE collector_client ENABLE ROW LEVEL SECURITY;
ALTER TABLE collector_client FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON collector_client
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- La tabla GLOBAL `tenant` no lleva tenant_id: su `id` ES el tenant. Bajo RLS, un
-- usuario del plano de datos (rol `app`) solo puede ver/gestionar su PROPIA fila; el
-- plano de control (SUPER_ADMIN, conexión BYPASSRLS) gobierna todas.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_self_isolation ON tenant
  USING      (id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Rol de CONTROL-PLANE: puede leer/escribir CUALQUIER tenant (BYPASSRLS) para que el
-- SUPER_ADMIN administre la plataforma (CRUD de tenants + provisión de admins). Lo usan
-- EXCLUSIVAMENTE los endpoints protegidos por SuperAdminGuard, vía PLATFORM_DATABASE_URL.
-- El plano de datos sigue 100% con el rol `app` (NOBYPASSRLS) + RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'platform') THEN
    CREATE ROLE platform LOGIN PASSWORD 'platform' NOSUPERUSER BYPASSRLS;
  END IF;
END$$;
--> statement-breakpoint
GRANT CONNECT ON DATABASE preztiaos TO platform;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO platform;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO platform;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO platform;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO platform;
