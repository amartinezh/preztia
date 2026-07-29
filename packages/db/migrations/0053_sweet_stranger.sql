CREATE TYPE "public"."conversation_failure_stage" AS ENUM('ASSISTANT_REPLY', 'DOCUMENT_INTAKE', 'AUDIO_INTAKE', 'LOCATION_CAPTURE', 'UNKNOWN');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_failure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"applicant_phone" text NOT NULL,
	"zone_path" "ltree",
	"stage" "conversation_failure_stage" NOT NULL,
	"message_kind" text NOT NULL,
	"message_id" text,
	"error_name" text NOT NULL,
	"error_message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_failure_applicant_idx" ON "conversation_failure" USING btree ("tenant_id","applicant_phone","created_at");