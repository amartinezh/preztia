CREATE TABLE IF NOT EXISTS "incoming_credit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"net_amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"payment_method_type" text NOT NULL,
	"transaction_type" text NOT NULL,
	"settlement_date" timestamp with time zone NOT NULL,
	"consumed_by_payment_id" uuid,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incoming_credit" ADD CONSTRAINT "incoming_credit_bank_account_id_tenant_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."tenant_bank_account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incoming_credit" ADD CONSTRAINT "incoming_credit_consumed_by_payment_id_payment_id_fk" FOREIGN KEY ("consumed_by_payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incoming_credit_tenant_source_idx" ON "incoming_credit" USING btree ("tenant_id","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incoming_credit_account_idx" ON "incoming_credit" USING btree ("bank_account_id","consumed_by_payment_id");--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`). Los créditos se
-- ingieren y se marcan como consumidos (UPDATE) durante la conciliación.
GRANT SELECT, INSERT, UPDATE, DELETE ON "incoming_credit" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "incoming_credit" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE "incoming_credit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incoming_credit" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "incoming_credit"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);