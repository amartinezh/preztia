-- Canal Telegram (ADR #40): aislamiento por tenant de las tablas de 0055 + resolución previa al
-- contexto de tenant para el webhook y el envío. Escrita a mano: drizzle-kit no representa RLS,
-- GRANT, REVOKE ni funciones en el esquema.

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`, purga de datos del tenant).
-- Las default privileges del init ya cubren tablas futuras; se reafirma explícitamente por robustez.
GRANT SELECT, INSERT, UPDATE, DELETE ON "telegram_channel" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "telegram_channel" TO platform;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "telegram_chat_link" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "telegram_chat_link" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (ENABLE + FORCE + POLICY, como el resto del esquema). Sin esto,
-- un tenant podría leer el token cifrado del bot o los teléfonos vinculados de otro.
ALTER TABLE "telegram_channel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_channel" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "telegram_channel"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint

ALTER TABLE "telegram_chat_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_chat_link" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "telegram_chat_link"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint

-- Resolución del tenant y de la zona de un bot por su channel_id (`tg:<bot_id>`), ANTES de tener
-- contexto de tenant: mismo patrón SECURITY DEFINER acotado que resolve_tenant_by_whatsapp_phone
-- (0027). Devuelven SOLO el id/la ruta; jamás el token ni filas completas.
CREATE OR REPLACE FUNCTION resolve_tenant_by_telegram_channel(p_channel_id text)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
AS $$
  SELECT tenant_id FROM telegram_channel WHERE channel_id = p_channel_id;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION resolve_tenant_by_telegram_channel(text) FROM PUBLIC;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION resolve_tenant_by_telegram_channel(text) TO app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION resolve_zone_path_by_telegram_channel(p_channel_id text)
  RETURNS ltree
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
AS $$
  SELECT zone_path FROM telegram_channel WHERE channel_id = p_channel_id;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION resolve_zone_path_by_telegram_channel(text) FROM PUBLIC;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION resolve_zone_path_by_telegram_channel(text) TO app;--> statement-breakpoint

-- Webhook: el update de Telegram no dice a qué bot llegó; se identifica por el id opaco de la URL.
-- Devuelve tenant + canal; el secret se lee después bajo RLS con el tenant ya fijado.
CREATE OR REPLACE FUNCTION resolve_telegram_hook(p_hook_id text)
  RETURNS TABLE (tenant_id uuid, channel_id text)
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
AS $$
  SELECT t.tenant_id, t.channel_id FROM telegram_channel t WHERE t.webhook_hook_id = p_hook_id;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION resolve_telegram_hook(text) FROM PUBLIC;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION resolve_telegram_hook(text) TO app;
