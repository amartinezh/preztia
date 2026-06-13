CREATE TYPE "public"."validation_status" AS ENUM('approved', 'suspicious', 'rejected');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_validation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"status" "validation_status" NOT NULL,
	"score" integer NOT NULL,
	"alerts" jsonb NOT NULL,
	"consulted_sources" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_extraction" ADD COLUMN "file_metadata" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_validation_application_idx" ON "document_validation" USING btree ("application_id");