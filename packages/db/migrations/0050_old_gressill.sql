ALTER TABLE "cash_transaction" ADD COLUMN "cash_count_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_transaction" ADD CONSTRAINT "cash_transaction_cash_count_id_cash_count_id_fk" FOREIGN KEY ("cash_count_id") REFERENCES "public"."cash_count"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cash_tx_count_idx" ON "cash_transaction" USING btree ("cash_count_id") WHERE cash_count_id is not null;