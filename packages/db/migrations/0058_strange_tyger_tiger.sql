CREATE TYPE "public"."debt_closure_type" AS ENUM('PAYROLL', 'WRITE_OFF');--> statement-breakpoint
CREATE TYPE "public"."remittance_status" AS ENUM('SUBMITTED', 'RECEIVED');--> statement-breakpoint
ALTER TYPE "public"."cash_tx_kind" ADD VALUE 'DEBT_CLOSURE';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collector_remittance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"cash_box_id" uuid NOT NULL,
	"zone_id" uuid,
	"status" "remittance_status" DEFAULT 'SUBMITTED' NOT NULL,
	"business_date" date NOT NULL,
	"due_at" timestamp with time zone,
	"summary" jsonb NOT NULL,
	"declared_minor" bigint NOT NULL,
	"collector_note" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid,
	"received_at" timestamp with time zone,
	"destination_cash_box_id" uuid,
	"expected_at_reception_minor" bigint,
	"counted_minor" bigint,
	"shortfall_minor" bigint,
	"closing_balance_minor" bigint,
	"cut_at" timestamp with time zone,
	"receiver_note" text,
	"transfer_group_id" uuid,
	CONSTRAINT "collector_remittance_received_chk" CHECK (status <> 'RECEIVED' or (
        received_at is not null and received_by is not null and cut_at is not null
        and counted_minor >= 0 and shortfall_minor >= 0
        and expected_at_reception_minor = counted_minor + shortfall_minor
        and closing_balance_minor is not null)),
	CONSTRAINT "collector_remittance_declared_chk" CHECK (declared_minor >= 0)
);
--> statement-breakpoint
ALTER TABLE "cash_transaction" ALTER COLUMN "created_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "tenant_config" ALTER COLUMN "operational_settings" SET DEFAULT '{"rechargesEnabled":false,"manualRoute":false,"blockOverdueDatesForSales":true,"blockInterestChange":true,"commissionPctBaseThousand":0,"defaultCreditLimitMinor":0,"applyColorByOverdue":false,"clientChoosesPlan":false,"planOfferTtlHours":24,"allowAdminOverride":true,"autoConfirmSettlement":false,"visitOverdueThreshold":3,"remittanceDeadlineHourLocal":20}'::jsonb;--> statement-breakpoint
ALTER TABLE "cash_transaction" ADD COLUMN "debt_closure_type" "debt_closure_type";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collector_remittance" ADD CONSTRAINT "collector_remittance_cash_box_id_cash_box_id_fk" FOREIGN KEY ("cash_box_id") REFERENCES "public"."cash_box"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "collector_remittance" ADD CONSTRAINT "collector_remittance_destination_cash_box_id_cash_box_id_fk" FOREIGN KEY ("destination_cash_box_id") REFERENCES "public"."cash_box"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "collector_remittance_one_open_idx" ON "collector_remittance" USING btree ("tenant_id","collector_id") WHERE status = 'SUBMITTED';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collector_remittance_collector_idx" ON "collector_remittance" USING btree ("tenant_id","collector_id","submitted_at");--> statement-breakpoint
ALTER TABLE "cash_transaction" ADD CONSTRAINT "cash_tx_debt_closure_type_chk" CHECK ((kind::text = 'DEBT_CLOSURE') = (debt_closure_type is not null));