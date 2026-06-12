CREATE TYPE "public"."installment_status" AS ENUM('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');--> statement-breakpoint
CREATE TYPE "public"."bank_verification_status" AS ENUM('CONFIRMED', 'NOT_FOUND', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('RECEIVED', 'VERIFIED', 'UNVERIFIED', 'REJECTED_FRAUD', 'REJECTED_INVALID');--> statement-breakpoint
CREATE TYPE "public"."unverified_payment_policy" AS ENUM('HOLD', 'ALLOCATE');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "borrower_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"borrower_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"channel_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "installment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"credit_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount_due_minor" bigint NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"status" "installment_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"credit_id" uuid,
	"provider_message_id" text,
	"channel_id" text,
	"payer_phone" text NOT NULL,
	"amount_minor" bigint,
	"currency" text NOT NULL,
	"paid_at" timestamp with time zone,
	"payer_name" text,
	"payer_tax_id" text,
	"payer_bank_name" text,
	"receiver_pix_key" text,
	"end_to_end_id" text,
	"txid" text,
	"extraction_raw" jsonb,
	"sha256" text,
	"storage_key" text,
	"mime_type" text,
	"status" "payment_status" DEFAULT 'RECEIVED' NOT NULL,
	"bank_status" "bank_verification_status",
	"bank_response" jsonb,
	"verified_at" timestamp with time zone,
	"reconciliation_attempts" integer DEFAULT 0 NOT NULL,
	"last_reconciliation_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid,
	"credit_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_bank_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	"bank_code" text NOT NULL,
	"pix_key" text,
	"api_key" text,
	"unverified_policy" "unverified_payment_policy" DEFAULT 'HOLD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "installment" ADD CONSTRAINT "installment_credit_id_credit_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."credit"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_installment_id_installment_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."installment"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "borrower_contact_tenant_phone_idx" ON "borrower_contact" USING btree ("tenant_id","phone");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "installment_credit_seq_idx" ON "installment" USING btree ("credit_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "installment_tenant_credit_idx" ON "installment" USING btree ("tenant_id","credit_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_tenant_end_to_end_idx" ON "payment" USING btree ("tenant_id","end_to_end_id") WHERE end_to_end_id is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_tenant_sha256_idx" ON "payment" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_tenant_status_idx" ON "payment" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_allocation_payment_installment_idx" ON "payment_allocation" USING btree ("payment_id","installment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_event_payment_idx" ON "payment_event" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_bank_account_tenant_bank_idx" ON "tenant_bank_account" USING btree ("tenant_id","country_code","bank_code");