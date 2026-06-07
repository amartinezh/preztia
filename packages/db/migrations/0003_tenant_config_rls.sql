-- RLS de aislamiento por tenant en tenant_config (mismo patrón que el resto de tablas).
ALTER TABLE tenant_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_config FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_config
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Resolver el tenant desde el webhook de WhatsApp (que solo trae phone_number_id).
-- Es un problema de "huevo y gallina": para leer tenant_config bajo RLS hace falta
-- conocer el tenant, pero el tenant es justo lo que buscamos. Esta función acotada
-- (SECURITY DEFINER, la ejecuta su dueño que sí puede ver la fila) devuelve SOLO el
-- tenant_id; el resto de la configuración se lee después con RLS y el tenant ya fijado.
CREATE OR REPLACE FUNCTION resolve_tenant_by_whatsapp_phone(p_phone_number_id text)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
AS $$
  SELECT tenant_id
  FROM tenant_config
  WHERE whatsapp_phone_number_id = p_phone_number_id;
$$;

-- Solo el rol de aplicación puede invocarla.
REVOKE EXECUTE ON FUNCTION resolve_tenant_by_whatsapp_phone(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION resolve_tenant_by_whatsapp_phone(text) TO app;
