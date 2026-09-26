CREATE TYPE "public"."field_order_event_type" AS ENUM('ISSUED', 'SEEN', 'REPORTED', 'DISPUTED', 'VERIFIED', 'CANCELLED', 'COMMENT');--> statement-breakpoint
CREATE TYPE "public"."field_order_kind" AS ENUM('DEPOSIT');--> statement-breakpoint
CREATE TYPE "public"."field_order_status" AS ENUM('ISSUED', 'SEEN', 'REPORTED', 'DISPUTED', 'VERIFIED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "field_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "field_order_kind" NOT NULL,
	"status" "field_order_status" DEFAULT 'ISSUED' NOT NULL,
	"collector_id" uuid NOT NULL,
	"route_cash_box_id" uuid NOT NULL,
	"zone_id" uuid,
	"destination_cash_box_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"instructions" text,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reported_amount_minor" bigint,
	"deposited_at" timestamp with time zone,
	"deposit_reference" text,
	"receipt_storage_key" text,
	"receipt_mime_type" text,
	"receipt_sha256" text,
	"reported_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verified_amount_minor" bigint,
	"transfer_group_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_order_amount_chk" CHECK (amount_minor > 0),
	CONSTRAINT "field_order_verified_chk" CHECK (status <> 'VERIFIED' or (verified_at is not null and verified_by is not null
        and verified_amount_minor > 0 and transfer_group_id is not null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "field_order_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"type" "field_order_event_type" NOT NULL,
	"actor_id" uuid NOT NULL,
	"message" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incoming_credit" ADD COLUMN "consumed_by_field_order_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "field_order" ADD CONSTRAINT "field_order_route_cash_box_id_cash_box_id_fk" FOREIGN KEY ("route_cash_box_id") REFERENCES "public"."cash_box"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "field_order" ADD CONSTRAINT "field_order_destination_cash_box_id_cash_box_id_fk" FOREIGN KEY ("destination_cash_box_id") REFERENCES "public"."cash_box"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "field_order_event" ADD CONSTRAINT "field_order_event_order_id_field_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."field_order"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_order_collector_idx" ON "field_order" USING btree ("tenant_id","collector_id","issued_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_order_status_idx" ON "field_order" USING btree ("tenant_id","status","issued_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "field_order_event_order_idx" ON "field_order_event" USING btree ("order_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incoming_credit" ADD CONSTRAINT "incoming_credit_consumed_by_field_order_id_field_order_id_fk" FOREIGN KEY ("consumed_by_field_order_id") REFERENCES "public"."field_order"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incoming_credit_field_order_idx" ON "incoming_credit" USING btree ("consumed_by_field_order_id") WHERE consumed_by_field_order_id is not null;--> statement-breakpoint
ALTER TABLE "incoming_credit" ADD CONSTRAINT "incoming_credit_single_consumer_chk" CHECK (consumed_by_payment_id is null or consumed_by_field_order_id is null);