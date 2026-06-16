CREATE TABLE IF NOT EXISTS "payment_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"installments_count" integer NOT NULL,
	"frequency" "frequency" DEFAULT 'DAILY' NOT NULL,
	"interest_pct" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_plan_tenant_name_idx" ON "payment_plan" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_plan_one_default_idx" ON "payment_plan" USING btree ("tenant_id") WHERE is_default = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_plan_tenant_idx" ON "payment_plan" USING btree ("tenant_id");--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`).
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_plan" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_plan" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE "payment_plan" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_plan" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payment_plan"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);