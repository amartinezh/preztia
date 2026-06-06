CREATE TYPE "public"."credit_status" AS ENUM('PENDING', 'ACTIVE', 'SETTLED', 'DEFAULTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."frequency" AS ENUM('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"borrower_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"principal_minor" bigint NOT NULL,
	"interest_pct" integer NOT NULL,
	"installments_count" integer NOT NULL,
	"frequency" "frequency" DEFAULT 'DAILY' NOT NULL,
	"currency" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "credit_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_zone_id" uuid,
	"path" "ltree" NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zone_coordinator" (
	"zone_id" uuid NOT NULL,
	"coordinator_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL
);
