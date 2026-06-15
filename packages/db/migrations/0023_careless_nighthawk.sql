CREATE TABLE IF NOT EXISTS "collector_location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collector_location_tenant_collector_idx" ON "collector_location" USING btree ("tenant_id","collector_id","recorded_at");--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`).
GRANT SELECT, INSERT, UPDATE, DELETE ON "collector_location" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "collector_location" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE "collector_location" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collector_location" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "collector_location"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);