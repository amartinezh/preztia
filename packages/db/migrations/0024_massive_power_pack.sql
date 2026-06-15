CREATE TABLE IF NOT EXISTS "borrower_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "borrower_list_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"borrower_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "borrower_list_tenant_name_idx" ON "borrower_list" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "borrower_list_member_unique_idx" ON "borrower_list_member" USING btree ("list_id","borrower_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "borrower_list_member_tenant_list_idx" ON "borrower_list_member" USING btree ("tenant_id","list_id");--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`).
GRANT SELECT, INSERT, UPDATE, DELETE ON "borrower_list", "borrower_list_member" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "borrower_list", "borrower_list_member" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE "borrower_list" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "borrower_list" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "borrower_list"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint
ALTER TABLE "borrower_list_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "borrower_list_member" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "borrower_list_member"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);