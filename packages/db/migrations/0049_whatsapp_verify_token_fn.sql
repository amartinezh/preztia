-- Handshake GET del webhook de WhatsApp: Meta presenta el verify token SIN phone_number_id,
-- así que se comprueba (por hash SHA-256) contra el conjunto de canales configurados, ANTES de
-- tener contexto de tenant. Función SECURITY DEFINER acotada, igual que
-- resolve_tenant_by_whatsapp_phone (0027): devuelve SOLO un boolean; jamás expone el token ni
-- filas de whatsapp_channel (que está bajo RLS FORCE).
CREATE OR REPLACE FUNCTION whatsapp_verify_token_hash_exists(p_sha256_hex text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM whatsapp_channel WHERE verify_token_sha256 = p_sha256_hex
  );
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION whatsapp_verify_token_hash_exists(text) FROM PUBLIC;--> statement-breakpoint
GRANT  EXECUTE ON FUNCTION whatsapp_verify_token_hash_exists(text) TO app;
