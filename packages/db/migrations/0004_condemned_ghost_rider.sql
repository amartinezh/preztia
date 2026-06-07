CREATE TYPE "public"."credit_application_status" AS ENUM('AWAITING_DOCUMENTS', 'IN_REVIEW', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('PENDING', 'RECEIVED', 'VALIDATED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."required_document" AS ENUM('IDENTITY_DOCUMENT', 'BUSINESS_VALIDITY_CERTIFICATE', 'PUBLIC_SERVICES_RECEIPT', 'BANK_STATEMENT', 'INCOME_PROOF');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"applicant_phone" text NOT NULL,
	"status" "credit_application_status" DEFAULT 'AWAITING_DOCUMENTS' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_application_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"document_type" "required_document" NOT NULL,
	"status" "document_status" DEFAULT 'PENDING' NOT NULL,
	"media_id" text,
	"storage_key" text,
	"mime_type" text,
	"sha256" text,
	"fraud_score" integer,
	"fraud_reasons" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_application_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "processed_inbound_message" (
	"tenant_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_inbound_message_tenant_id_message_id_pk" PRIMARY KEY("tenant_id","message_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_application_document" ADD CONSTRAINT "credit_application_document_application_id_credit_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."credit_application"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_application_active_applicant_idx" ON "credit_application" USING btree ("tenant_id","applicant_phone") WHERE status in ('AWAITING_DOCUMENTS', 'IN_REVIEW');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_application_document_type_idx" ON "credit_application_document" USING btree ("application_id","document_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_application_event_application_idx" ON "credit_application_event" USING btree ("application_id");