CREATE TYPE "public"."route_stop_outcome" AS ENUM('PAID', 'NOT_PAID', 'PROMISE', 'NOT_FOUND');--> statement-breakpoint
CREATE TYPE "public"."route_stop_status" AS ENUM('ASSIGNED', 'SEEN', 'RESOLVED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collection_route" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"service_date" date NOT NULL,
	"created_by" uuid NOT NULL,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_stop" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"credit_id" uuid NOT NULL,
	"borrower_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"status" "route_stop_status" DEFAULT 'ASSIGNED' NOT NULL,
	"client_name" text NOT NULL,
	"address" text,
	"phone" text,
	"lat" double precision,
	"lng" double precision,
	"amount_to_collect_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"dispatched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone,
	"outcome" "route_stop_outcome",
	"collected_minor" bigint,
	"outcome_reason" text,
	"promise_date" date,
	"note" text,
	"payment_id" uuid,
	"resolved_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancel_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "route_stop_resolved_chk" CHECK (status <> 'RESOLVED' or (outcome is not null and resolved_at is not null)),
	CONSTRAINT "route_stop_paid_chk" CHECK ((outcome = 'PAID') = (collected_minor is not null and collected_minor > 0)
          or outcome is null)
);
--> statement-breakpoint
ALTER TABLE "borrower" ADD COLUMN "address" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_stop" ADD CONSTRAINT "route_stop_route_id_collection_route_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."collection_route"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "route_stop" ADD CONSTRAINT "route_stop_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collection_route_zone_idx" ON "collection_route" USING btree ("tenant_id","zone_id","dispatched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_stop_collector_idx" ON "route_stop" USING btree ("tenant_id","collector_id","status","sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "route_stop_route_idx" ON "route_stop" USING btree ("route_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "route_stop_one_open_idx" ON "route_stop" USING btree ("credit_id") WHERE status in ('ASSIGNED', 'SEEN');