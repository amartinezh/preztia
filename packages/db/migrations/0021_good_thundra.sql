CREATE TYPE "public"."expense_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" "expense_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"collector_id" uuid,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"caja_anterior_minor" bigint NOT NULL,
	"total_cobrado_minor" bigint NOT NULL,
	"total_prestado_minor" bigint NOT NULL,
	"gastos_minor" bigint NOT NULL,
	"caja_actual_minor" bigint NOT NULL,
	"cuentas_nuevas" integer DEFAULT 0 NOT NULL,
	"cuentas_terminadas" integer DEFAULT 0 NOT NULL,
	"closed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_tenant_status_idx" ON "expense" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlement_tenant_created_idx" ON "settlement" USING btree ("tenant_id","created_at");--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`). Las default
-- privileges del init ya cubren tablas futuras; se reafirma explícitamente por robustez.
GRANT SELECT, INSERT, UPDATE, DELETE ON "expense", "settlement" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "expense", "settlement" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE "expense" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expense" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "expense"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint
ALTER TABLE "settlement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlement" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "settlement"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);