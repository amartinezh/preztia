CREATE TYPE "public"."ai_provider" AS ENUM('GEMINI', 'OPENAI', 'CLAUDE');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_config" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"whatsapp_phone_number_id" text,
	"knowledge_base" text DEFAULT '' NOT NULL,
	"ai_provider" "ai_provider" DEFAULT 'GEMINI' NOT NULL,
	"ai_api_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_config_whatsapp_phone_idx" ON "tenant_config" USING btree ("whatsapp_phone_number_id");