CREATE TYPE "public"."payment_charge_status" AS ENUM('AWAITING_SELECTION', 'PENDING', 'PAID', 'EXPIRED', 'CANCELED', 'FAILED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_charge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"credit_id" uuid NOT NULL,
	"payment_id" uuid,
	"phone" text NOT NULL,
	"channel_id" text NOT NULL,
	"provider" "bank_provider_type" NOT NULL,
	"merchant_charge_id" text,
	"amount_minor" bigint,
	"installment_minor" bigint,
	"overdue_minor" bigint,
	"currency" text NOT NULL,
	"copy_paste" text,
	"status" "payment_charge_status" DEFAULT 'AWAITING_SELECTION' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_config" ALTER COLUMN "operational_settings" SET DEFAULT '{"rechargesEnabled":false,"manualRoute":false,"blockOverdueDatesForSales":true,"blockInterestChange":true,"commissionPctBaseThousand":0,"defaultCreditLimitMinor":0,"applyColorByOverdue":false,"clientChoosesPlan":false,"planOfferTtlHours":24,"allowAdminOverride":true,"autoConfirmSettlement":false}'::jsonb;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_charge" ADD CONSTRAINT "payment_charge_credit_id_credit_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."credit"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_charge" ADD CONSTRAINT "payment_charge_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_charge_open_session_idx" ON "payment_charge" USING btree ("tenant_id","phone") WHERE status = 'AWAITING_SELECTION';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_charge_tenant_merchant_idx" ON "payment_charge" USING btree ("tenant_id","merchant_charge_id") WHERE merchant_charge_id is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_charge_credit_idx" ON "payment_charge" USING btree ("credit_id","created_at");--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`). El ciclo del cobro crea
-- la sesión (INSERT), la avanza a PENDING/PAID (UPDATE) y limpia sesiones abandonadas (DELETE).
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_charge" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_charge" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE "payment_charge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_charge" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payment_charge"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
