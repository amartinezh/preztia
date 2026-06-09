CREATE TABLE IF NOT EXISTS "document_extraction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"document_type" "required_document" NOT NULL,
	"applicant_phone" text NOT NULL,
	"media_id" text,
	"provider" "ai_provider" NOT NULL,
	"model" text,
	"identified_type" text,
	"matches_expected" boolean,
	"confidence" integer,
	"fields" jsonb,
	"raw_text" text,
	"raw_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_extraction_application_idx" ON "document_extraction" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_extraction_applicant_idx" ON "document_extraction" USING btree ("tenant_id","applicant_phone");