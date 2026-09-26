ALTER TABLE "cash_box" ADD COLUMN "zone_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_transaction" ADD COLUMN "zone_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_transaction" ADD COLUMN "collector_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD COLUMN "principal_minor" bigint;--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD COLUMN "interest_minor" bigint;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_tx_zone_created_idx" ON "cash_transaction" USING btree ("zone_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_tx_collector_created_idx" ON "cash_transaction" USING btree ("collector_id","created_at");--> statement-breakpoint
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_split_chk" CHECK (("payment_allocation"."principal_minor" is null and "payment_allocation"."interest_minor" is null)
       or ("payment_allocation"."principal_minor" >= 0 and "payment_allocation"."interest_minor" >= 0
           and "payment_allocation"."principal_minor" + "payment_allocation"."interest_minor" = "payment_allocation"."amount_minor"));