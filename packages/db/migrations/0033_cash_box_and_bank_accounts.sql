CREATE TYPE "public"."bank_sync_status" AS ENUM('MATCHED', 'MISMATCH', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."cash_box_type" AS ENUM('CASH', 'BANK', 'TRANSIT');--> statement-breakpoint
CREATE TYPE "public"."cash_tx_direction" AS ENUM('IN', 'OUT');--> statement-breakpoint
CREATE TYPE "public"."cash_tx_kind" AS ENUM('PAYMENT_IN', 'WITHDRAWAL', 'EXPENSE', 'TRANSFER', 'ADJUSTMENT', 'UNIDENTIFIED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_reconciliation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cash_box_id" uuid NOT NULL,
	"system_minor" bigint NOT NULL,
	"bank_minor" bigint,
	"difference_minor" bigint,
	"status" "bank_sync_status" NOT NULL,
	"raw_response" jsonb,
	"synced_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cash_box" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "cash_box_type" NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"bank_account_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_box_bank_link_chk" CHECK (("cash_box"."type" = 'BANK' and "cash_box"."bank_account_id" is not null)
       or ("cash_box"."type" <> 'BANK' and "cash_box"."bank_account_id" is null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cash_count" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cash_box_id" uuid NOT NULL,
	"system_minor" bigint NOT NULL,
	"counted_minor" bigint NOT NULL,
	"difference_minor" bigint NOT NULL,
	"notes" text,
	"performed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cash_transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cash_box_id" uuid NOT NULL,
	"direction" "cash_tx_direction" NOT NULL,
	"kind" "cash_tx_kind" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"reason" text,
	"payment_id" uuid,
	"expense_id" uuid,
	"transfer_group_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_tx_amount_positive_chk" CHECK (amount_minor > 0)
);
--> statement-breakpoint
-- label/bank_name son NOT NULL: se agregan nullable, se rellenan las filas existentes
-- con el bank_code (valor sensato) y luego se fija la restricción (backfill seguro).
ALTER TABLE "tenant_bank_account" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "tenant_bank_account" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "tenant_bank_account" ADD COLUMN "account_number" text;--> statement-breakpoint
UPDATE "tenant_bank_account" SET "label" = COALESCE("label", "bank_code"), "bank_name" = COALESCE("bank_name", "bank_code");--> statement-breakpoint
ALTER TABLE "tenant_bank_account" ALTER COLUMN "label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_bank_account" ALTER COLUMN "bank_name" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_reconciliation" ADD CONSTRAINT "bank_reconciliation_cash_box_id_cash_box_id_fk" FOREIGN KEY ("cash_box_id") REFERENCES "public"."cash_box"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_box" ADD CONSTRAINT "cash_box_bank_account_id_tenant_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."tenant_bank_account"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_count" ADD CONSTRAINT "cash_count_cash_box_id_cash_box_id_fk" FOREIGN KEY ("cash_box_id") REFERENCES "public"."cash_box"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_transaction" ADD CONSTRAINT "cash_transaction_cash_box_id_cash_box_id_fk" FOREIGN KEY ("cash_box_id") REFERENCES "public"."cash_box"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_transaction" ADD CONSTRAINT "cash_transaction_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash_transaction" ADD CONSTRAINT "cash_transaction_expense_id_expense_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_reconciliation_box_created_idx" ON "bank_reconciliation" USING btree ("cash_box_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cash_box_one_transit_idx" ON "cash_box" USING btree ("tenant_id") WHERE type = 'TRANSIT';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cash_box_bank_account_idx" ON "cash_box" USING btree ("bank_account_id") WHERE bank_account_id is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_count_box_created_idx" ON "cash_count" USING btree ("cash_box_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_tx_box_created_idx" ON "cash_transaction" USING btree ("cash_box_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cash_tx_tenant_created_idx" ON "cash_transaction" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cash_tx_payment_idx" ON "cash_transaction" USING btree ("payment_id") WHERE payment_id is not null and kind = 'PAYMENT_IN';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_bank_account_tenant_pix_idx" ON "tenant_bank_account" USING btree ("tenant_id","pix_key") WHERE pix_key is not null;--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`).
GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_box" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_box" TO platform;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_transaction" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_transaction" TO platform;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_count" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "cash_count" TO platform;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_reconciliation" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_reconciliation" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE "cash_box" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_box" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "cash_box"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint
ALTER TABLE "cash_transaction" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_transaction" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "cash_transaction"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint
ALTER TABLE "cash_count" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash_count" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "cash_count"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint
ALTER TABLE "bank_reconciliation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_reconciliation" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bank_reconciliation"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint

-- Integridad financiera: el libro mayor de caja y las bitácoras de arqueo/conciliación son
-- APPEND-ONLY — el rol de aplicación inserta y consulta, pero NO edita ni borra movimientos
-- de dinero ni el historial de cuadres (rastro de auditoría inmutable). Correcciones = ajuste.
REVOKE UPDATE, DELETE ON cash_transaction FROM app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON cash_count FROM app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON bank_reconciliation FROM app;