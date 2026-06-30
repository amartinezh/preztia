CREATE TYPE "public"."fraud_assessment_phase" AS ENUM('PHASE1_SCREEN', 'PHASE2_SETTLEMENT');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fraud_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"phase" "fraud_assessment_phase" NOT NULL,
	"status" text NOT NULL,
	"score" integer,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fraud_assessment" ADD CONSTRAINT "fraud_assessment_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fraud_assessment_payment_idx" ON "fraud_assessment" USING btree ("tenant_id","payment_id");--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`).
GRANT SELECT, INSERT, UPDATE, DELETE ON "fraud_assessment" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "fraud_assessment" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE "fraud_assessment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fraud_assessment" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "fraud_assessment"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint

-- Bitácora antifraude INMUTABLE: el rol de aplicación inserta y consulta, pero NO edita ni borra
-- (rastro de auditoría). El borrado en cascada con el pago lo ejecuta el sistema, no el rol.
REVOKE UPDATE, DELETE ON fraud_assessment FROM app;