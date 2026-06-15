-- Extensiones requeridas
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- Rol de aplicación: NO superusuario, NO bypass de RLS
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END$$;
GRANT CONNECT ON DATABASE preztiaos TO app;
GRANT USAGE ON SCHEMA public TO app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;

-- Rol de CONTROL-PLANE: BYPASSRLS para que el SUPER_ADMIN administre la plataforma
-- (CRUD de tenants + provisión de admins) a través de PLATFORM_DATABASE_URL. Lo usan
-- SOLO los endpoints protegidos por SuperAdminGuard; el plano de datos sigue con `app`.
-- (La migración 0019_iam_rls lo recrea de forma idempotente para volúmenes existentes.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'platform') THEN
    CREATE ROLE platform LOGIN PASSWORD 'platform' NOSUPERUSER BYPASSRLS;
  END IF;
END$$;
GRANT CONNECT ON DATABASE preztiaos TO platform;
GRANT USAGE ON SCHEMA public TO platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO platform;
