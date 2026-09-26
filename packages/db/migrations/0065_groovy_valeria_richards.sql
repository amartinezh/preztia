CREATE TABLE IF NOT EXISTS "settlement_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"frequency" text NOT NULL,
	"retroactive" boolean DEFAULT false NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "settlement_period_range_chk" CHECK (period_start < period_end and starts_at < ends_at)
);
--> statement-breakpoint
ALTER TABLE "tenant_config" ALTER COLUMN "operational_settings" SET DEFAULT '{"rechargesEnabled":false,"manualRoute":false,"blockOverdueDatesForSales":true,"blockInterestChange":true,"commissionPctBaseThousand":0,"defaultCreditLimitMinor":0,"applyColorByOverdue":false,"clientChoosesPlan":false,"planOfferTtlHours":24,"allowAdminOverride":true,"autoConfirmSettlement":false,"visitOverdueThreshold":3,"remittanceDeadlineHourLocal":20,"settlementFrequency":"WEEKLY","settlementAnchorDay":1,"settlementAutoClose":true}'::jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "settlement_period_start_idx" ON "settlement_period" USING btree ("tenant_id","period_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "settlement_period_end_idx" ON "settlement_period" USING btree ("tenant_id","period_end");