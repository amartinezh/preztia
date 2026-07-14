ALTER TYPE "public"."cash_tx_kind" ADD VALUE 'DISBURSEMENT' BEFORE 'WITHDRAWAL';--> statement-breakpoint
ALTER TABLE "cash_transaction" ADD COLUMN "credit_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_transaction" ADD CONSTRAINT "cash_transaction_credit_id_credit_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."credit"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cash_tx_credit_idx" ON "cash_transaction" USING btree ("credit_id") WHERE credit_id is not null;