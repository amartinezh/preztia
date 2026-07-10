ALTER TABLE "whatsapp_channel" ADD COLUMN "access_token" text;--> statement-breakpoint
ALTER TABLE "whatsapp_channel" ADD COLUMN "app_secret" text;--> statement-breakpoint
ALTER TABLE "whatsapp_channel" ADD COLUMN "verify_token_sha256" text;--> statement-breakpoint
ALTER TABLE "whatsapp_channel" ADD COLUMN "graph_version" text;