DROP INDEX IF EXISTS "cash_tx_payment_idx";--> statement-breakpoint
ALTER TABLE "cash_transaction" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cash_tx_payment_idx" ON "cash_transaction" USING btree ("payment_id") WHERE payment_id is not null;