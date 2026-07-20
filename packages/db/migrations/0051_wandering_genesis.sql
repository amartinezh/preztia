CREATE TABLE IF NOT EXISTS "collection_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"credit_id" uuid NOT NULL,
	"borrower_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_visit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"credit_id" uuid NOT NULL,
	"borrower_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"overdue_count_at_visit" integer NOT NULL,
	"days_overdue_at_visit" integer DEFAULT 0 NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_config" ALTER COLUMN "operational_settings" SET DEFAULT '{"rechargesEnabled":false,"manualRoute":false,"blockOverdueDatesForSales":true,"blockInterestChange":true,"commissionPctBaseThousand":0,"defaultCreditLimitMinor":0,"applyColorByOverdue":false,"clientChoosesPlan":false,"planOfferTtlHours":24,"allowAdminOverride":true,"autoConfirmSettlement":false,"visitOverdueThreshold":3}'::jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_note_tenant_credit_idx" ON "collection_note" USING btree ("tenant_id","credit_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_visit_tenant_credit_idx" ON "collection_visit" USING btree ("tenant_id","credit_id","visited_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_visit_tenant_collector_idx" ON "collection_visit" USING btree ("tenant_id","collector_id");--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`). Las default privileges
-- del init ya cubren tablas futuras; se reafirma explícitamente por robustez.
GRANT SELECT, INSERT, UPDATE, DELETE ON "collection_note", "collection_visit" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "collection_note", "collection_visit" TO platform;--> statement-breakpoint

-- APPEND-ONLY: el rol de datos solo inserta y lee; la bitácora de visitas/observaciones no se
-- edita ni borra (mismo criterio que `audit_log`). El `platform` conserva UPDATE/DELETE (purga).
REVOKE UPDATE, DELETE ON "collection_note", "collection_visit" FROM app;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón que el resto: ENABLE + FORCE + POLICY).
ALTER TABLE "collection_note" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collection_note" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "collection_note"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint
ALTER TABLE "collection_visit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collection_visit" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "collection_visit"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);