CREATE TYPE "public"."bank_provider_type" AS ENUM('MANUAL', 'INTER', 'MERCADOPAGO');--> statement-breakpoint
ALTER TABLE "tenant_bank_account" ADD COLUMN "provider_type" "bank_provider_type" DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
-- Backfill: las cuentas existentes con integración Inter conservan su proveedor (el default
-- 'MANUAL' las mistiparía). El resto queda MANUAL hasta que el admin lo configure.
UPDATE "tenant_bank_account" SET "provider_type" = 'INTER' WHERE "bank_code" = 'INTER';--> statement-breakpoint
ALTER TABLE "tenant_bank_account" ADD COLUMN "receiver_tax_id" text;--> statement-breakpoint
ALTER TABLE "tenant_bank_account" ADD COLUMN "receiver_name" text;--> statement-breakpoint
ALTER TABLE "tenant_bank_account" ADD COLUMN "report_config" jsonb;