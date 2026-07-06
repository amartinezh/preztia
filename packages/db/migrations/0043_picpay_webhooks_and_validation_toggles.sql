ALTER TYPE "public"."bank_provider_type" ADD VALUE 'PICPAY';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_webhook_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"provider_type" "bank_provider_type" NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text,
	"payload" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incoming_credit" ADD COLUMN "end_to_end_id" text;--> statement-breakpoint
ALTER TABLE "tenant_bank_account" ADD COLUMN "verify_payments_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_bank_account" ADD COLUMN "balance_check_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_webhook_event" ADD CONSTRAINT "provider_webhook_event_bank_account_id_tenant_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."tenant_bank_account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_webhook_event_tenant_event_idx" ON "provider_webhook_event" USING btree ("tenant_id","provider_type","event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_webhook_event_account_idx" ON "provider_webhook_event" USING btree ("bank_account_id","received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incoming_credit_tenant_e2e_idx" ON "incoming_credit" USING btree ("tenant_id","end_to_end_id");--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`). La bitácora de
-- webhooks es APPEND-ONLY para la aplicación: inserta y lee, no edita ni borra (el DELETE
-- llega solo por cascada del dueño del esquema al borrar la cuenta).
GRANT SELECT, INSERT ON "provider_webhook_event" TO app;--> statement-breakpoint
GRANT SELECT, INSERT ON "provider_webhook_event" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE "provider_webhook_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_webhook_event" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "provider_webhook_event"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
