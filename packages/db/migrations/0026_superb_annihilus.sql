CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"payload" jsonb,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "idempotency_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_tenant_created_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_key_tenant_key_idx" ON "idempotency_key" USING btree ("tenant_id","key");--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`).
GRANT SELECT, INSERT, UPDATE, DELETE ON "idempotency_key" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "idempotency_key" TO platform;--> statement-breakpoint
-- audit_log es APPEND-ONLY: el rol `app` solo puede insertar y leer (NO editar/borrar historial).
GRANT SELECT, INSERT ON "audit_log" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "audit_log" TO platform;--> statement-breakpoint
REVOKE UPDATE, DELETE ON "audit_log" FROM app;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "audit_log"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint
ALTER TABLE "idempotency_key" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "idempotency_key" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "idempotency_key"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);