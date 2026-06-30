CREATE TABLE IF NOT EXISTS "bank_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bank_credential" ADD CONSTRAINT "bank_credential_bank_account_id_tenant_bank_account_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."tenant_bank_account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_credential_account_name_idx" ON "bank_credential" USING btree ("bank_account_id","name");--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`). Los secretos son
-- MUTABLES (rotación/baja de credenciales): el rol de aplicación inserta, lee, actualiza y borra
-- (no es append-only como el libro mayor).
GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_credential" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_credential" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE "bank_credential" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_credential" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bank_credential"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);