CREATE TYPE "public"."borrower_color" AS ENUM('NONE', 'YELLOW', 'BLUE', 'RED', 'GREEN', 'ORANGE');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "borrower_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"borrower_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "borrower" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"national_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"business" text,
	"phone" text,
	"lat" double precision,
	"lng" double precision,
	"color" "borrower_color" DEFAULT 'NONE' NOT NULL,
	"credit_blocked" boolean DEFAULT false NOT NULL,
	"credit_limit_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "borrower_note_tenant_borrower_idx" ON "borrower_note" USING btree ("tenant_id","borrower_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "borrower_tenant_national_id_idx" ON "borrower" USING btree ("tenant_id","national_id");--> statement-breakpoint

-- Backfill (DML): da identidad a los clientes que hoy solo existen como `borrower_id` en
-- `credit`, para que aparezcan en el nuevo registro de clientes sin perder datos. Se ejecuta
-- ANTES de activar RLS (el dueño del esquema inserta sin restricción). `borrower.id` reusa el
-- `borrower_id` existente para que `credit`/`borrower_contact`/`collector_client` sigan
-- apuntando a la misma fila; `national_id` provisional = id (único por tenant); el nombre
-- queda como marcador editable. El teléfono se toma del contacto de WhatsApp más reciente.
INSERT INTO "borrower" ("id", "tenant_id", "national_id", "first_name", "phone")
SELECT DISTINCT ON (c."borrower_id")
  c."borrower_id", c."tenant_id", c."borrower_id"::text, 'Cliente', bc."phone"
FROM "credit" c
LEFT JOIN "borrower_contact" bc
  ON bc."borrower_id" = c."borrower_id" AND bc."tenant_id" = c."tenant_id"
WHERE NOT EXISTS (SELECT 1 FROM "borrower" b WHERE b."id" = c."borrower_id")
ORDER BY c."borrower_id", bc."created_at" DESC NULLS LAST;--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`). Las default
-- privileges del init ya cubren tablas futuras; se reafirma explícitamente por robustez.
GRANT SELECT, INSERT, UPDATE, DELETE ON "borrower", "borrower_note" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "borrower", "borrower_note" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón que el resto: ENABLE + FORCE + POLICY).
ALTER TABLE "borrower" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "borrower" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "borrower"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint
ALTER TABLE "borrower_note" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "borrower_note" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "borrower_note"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);