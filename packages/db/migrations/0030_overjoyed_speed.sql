CREATE TYPE "public"."plan_offer_status" AS ENUM('NOT_OFFERED', 'AWAITING_SELECTION', 'AWAITING_ACCEPTANCE', 'ACCEPTED', 'DECLINED');--> statement-breakpoint
ALTER TABLE "credit_application" ADD COLUMN "plan_offer_status" "plan_offer_status" DEFAULT 'NOT_OFFERED' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_application" ADD COLUMN "offered_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_application" ADD COLUMN "offered_principal_minor" bigint;--> statement-breakpoint
ALTER TABLE "credit_application" ADD COLUMN "offer_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_application" ADD COLUMN "client_accepted_at" timestamp with time zone;