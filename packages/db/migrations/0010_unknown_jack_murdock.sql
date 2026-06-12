CREATE TYPE "public"."conversation_direction" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"applicant_phone" text NOT NULL,
	"direction" "conversation_direction" NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"media_id" text,
	"mime_type" text,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_message_applicant_idx" ON "conversation_message" USING btree ("tenant_id","applicant_phone","created_at");