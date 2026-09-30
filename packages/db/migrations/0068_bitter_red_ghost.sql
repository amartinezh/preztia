CREATE TYPE "public"."commission_base" AS ENUM('COLLECTED', 'REMITTED', 'PRINCIPAL_RECOVERED');--> statement-breakpoint
ALTER TYPE "public"."cash_tx_kind" ADD VALUE 'COMMISSION';--> statement-breakpoint
ALTER TABLE "tenant_config" ALTER COLUMN "operational_settings" SET DEFAULT '{"rechargesEnabled":false,"manualRoute":false,"blockOverdueDatesForSales":true,"blockInterestChange":true,"commissionPctBaseThousand":0,"commissionsEnabled":false,"commissionBase":"COLLECTED","commissionMaxPctBaseThousand":0,"defaultCreditLimitMinor":0,"applyColorByOverdue":false,"clientChoosesPlan":false,"planOfferTtlHours":24,"allowAdminOverride":true,"autoConfirmSettlement":false,"visitOverdueThreshold":3,"remittanceDeadlineHourLocal":20,"settlementFrequency":"WEEKLY","settlementAnchorDay":1,"settlementAutoClose":true,"settlementStartDate":null}'::jsonb;--> statement-breakpoint
ALTER TABLE "cash_transaction" ADD COLUMN "settlement_period_id" uuid;--> statement-breakpoint
ALTER TABLE "zone" ADD COLUMN "commission_rate_per_mille" integer;--> statement-breakpoint
ALTER TABLE "zone" ADD COLUMN "commission_base" "commission_base";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_transaction" ADD CONSTRAINT "cash_transaction_settlement_period_id_settlement_period_id_fk" FOREIGN KEY ("settlement_period_id") REFERENCES "public"."settlement_period"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cash_tx_commission_idx" ON "cash_transaction" USING btree ("settlement_period_id","collector_id") WHERE settlement_period_id is not null;--> statement-breakpoint
ALTER TABLE "cash_transaction" ADD CONSTRAINT "cash_tx_commission_chk" CHECK ((kind::text = 'COMMISSION') = (settlement_period_id is not null and collector_id is not null));--> statement-breakpoint
ALTER TABLE "zone" ADD CONSTRAINT "zone_commission_complete_chk" CHECK ((commission_rate_per_mille is null) = (commission_base is null));--> statement-breakpoint
ALTER TABLE "zone" ADD CONSTRAINT "zone_commission_rate_chk" CHECK (commission_rate_per_mille is null or commission_rate_per_mille between 0 and 1000);