ALTER TYPE "public"."required_document" ADD VALUE 'BUSINESS_PHOTO' BEFORE 'PUBLIC_SERVICES_RECEIPT';--> statement-breakpoint
ALTER TABLE "credit_application" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "credit_application" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "credit_application" ADD COLUMN "location_shared_at" timestamp with time zone;