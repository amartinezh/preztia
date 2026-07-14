ALTER TABLE "settlement" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "settlement" CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cash_tx_expense_idx" ON "cash_transaction" USING btree ("expense_id") WHERE expense_id is not null;