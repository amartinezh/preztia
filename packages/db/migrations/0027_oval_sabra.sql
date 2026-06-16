CREATE TABLE IF NOT EXISTS "credit_application_rejection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone_number_id" text NOT NULL,
	"zone_id" uuid NOT NULL,
	"zone_path" "ltree" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_message" ADD COLUMN "zone_path" "ltree";--> statement-breakpoint
ALTER TABLE "credit_application" ADD COLUMN "zone_path" "ltree";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_application_rejection_tenant_idx" ON "credit_application_rejection" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_channel_phone_idx" ON "whatsapp_channel" USING btree ("phone_number_id");--> statement-breakpoint

-- Índices GiST para el predicado de subárbol (zone_path <@ scope) en el scoping por zona.
CREATE INDEX IF NOT EXISTS "conversation_message_zone_path_idx" ON "conversation_message" USING gist ("zone_path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_application_zone_path_idx" ON "credit_application" USING gist ("zone_path");--> statement-breakpoint

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`).
GRANT SELECT, INSERT, UPDATE, DELETE ON "whatsapp_channel", "credit_application_rejection" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "whatsapp_channel", "credit_application_rejection" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón: ENABLE + FORCE + POLICY tenant_isolation).
ALTER TABLE "whatsapp_channel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_channel" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "whatsapp_channel"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint
ALTER TABLE "credit_application_rejection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_application_rejection" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "credit_application_rejection"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint

-- Resolución del tenant por número: ahora considera primero whatsapp_channel (un número por
-- zona) y cae a tenant_config (compatibilidad con el número único existente). SECURITY DEFINER.
CREATE OR REPLACE FUNCTION resolve_tenant_by_whatsapp_phone(p_phone_number_id text)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT tenant_id FROM whatsapp_channel WHERE phone_number_id = p_phone_number_id),
    (SELECT tenant_id FROM tenant_config   WHERE whatsapp_phone_number_id = p_phone_number_id)
  );
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION resolve_tenant_by_whatsapp_phone(text) FROM PUBLIC;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION resolve_tenant_by_whatsapp_phone(text) TO app;--> statement-breakpoint

-- Resolución de la ZONA (zone_path) por número, para estampar conversaciones/solicitudes.
CREATE OR REPLACE FUNCTION resolve_zone_path_by_whatsapp_phone(p_phone_number_id text)
  RETURNS ltree
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
AS $$
  SELECT zone_path FROM whatsapp_channel WHERE phone_number_id = p_phone_number_id;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION resolve_zone_path_by_whatsapp_phone(text) FROM PUBLIC;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION resolve_zone_path_by_whatsapp_phone(text) TO app;