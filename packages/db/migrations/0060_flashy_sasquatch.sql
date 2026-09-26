ALTER TABLE "expense" ADD COLUMN "zone_id" uuid;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "paid_from_cash_box_id" uuid;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "receipt_storage_key" text;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "receipt_mime_type" text;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN "receipt_sha256" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expense" ADD CONSTRAINT "expense_paid_from_cash_box_id_cash_box_id_fk" FOREIGN KEY ("paid_from_cash_box_id") REFERENCES "public"."cash_box"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expense_requester_created_idx" ON "expense" USING btree ("tenant_id","requested_by","created_at");