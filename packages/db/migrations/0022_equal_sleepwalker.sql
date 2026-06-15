CREATE TYPE "public"."change_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"borrower_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"changes" jsonb NOT NULL,
	"status" "change_request_status" DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_request_tenant_status_idx" ON "change_request" USING btree ("tenant_id","status","created_at");--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`).
GRANT SELECT, INSERT, UPDATE, DELETE ON "change_request" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "change_request" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE "change_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "change_request" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "change_request"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);