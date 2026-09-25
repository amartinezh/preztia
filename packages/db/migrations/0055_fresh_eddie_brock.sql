ALTER TYPE "public"."conversation_failure_stage" ADD VALUE 'CONTACT_VERIFICATION' BEFORE 'UNKNOWN';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telegram_channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bot_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"bot_username" text,
	"zone_id" uuid NOT NULL,
	"zone_path" "ltree" NOT NULL,
	"bot_token" text NOT NULL,
	"webhook_hook_id" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"webhook_registered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telegram_chat_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"chat_id" text NOT NULL,
	"phone" text,
	"verified_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_config" ADD COLUMN "messaging_channels" jsonb DEFAULT '{"whatsappEnabled":true,"telegramEnabled":false,"preferredProactiveChannel":"WHATSAPP"}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_channel_bot_idx" ON "telegram_channel" USING btree ("bot_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_channel_channel_idx" ON "telegram_channel" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_channel_hook_idx" ON "telegram_channel" USING btree ("webhook_hook_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_channel_zone_idx" ON "telegram_channel" USING btree ("zone_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_chat_link_chat_idx" ON "telegram_chat_link" USING btree ("channel_id","chat_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "telegram_chat_link_phone_idx" ON "telegram_chat_link" USING btree ("channel_id","phone") WHERE phone IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_chat_link_tenant_phone_idx" ON "telegram_chat_link" USING btree ("tenant_id","phone");