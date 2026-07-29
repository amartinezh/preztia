-- Bandeja de WhatsApp: aislamiento de la bitácora de fallos + permiso de depuración.
-- Escrita a mano: drizzle-kit no representa RLS, GRANT ni REVOKE en el esquema.
-- Complementa a 0053, que solo creó la tabla `conversation_failure`.

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`). Las default
-- privileges del init ya cubren tablas futuras; se reafirma explícitamente por robustez.
GRANT SELECT, INSERT, UPDATE, DELETE ON "conversation_failure" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "conversation_failure" TO platform;--> statement-breakpoint

-- RLS de aislamiento por tenant (mismo patrón que el resto: ENABLE + FORCE + POLICY).
-- Sin esto la tabla no filtra por tenant: los lectores del read model NO llevan predicado
-- `tenant_id` propio porque delegan el aislamiento en la política, como el resto del sistema.
ALTER TABLE "conversation_failure" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_failure" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "conversation_failure"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint

-- Un fallo registrado NUNCA se edita: es el diagnóstico de lo que le pasó a un cliente en un
-- instante concreto. El DELETE sí se permite porque la depuración de la bandeja retira la
-- conversación completa (mensajes + fallos) cuando el operador la da por agotada.
REVOKE UPDATE ON "conversation_failure" FROM app;--> statement-breakpoint

-- El transcript deja de ser estrictamente append-only para el rol de datos: la migración 0011
-- revocó UPDATE y DELETE, y la consola de comunicaciones necesita poder DEPURAR la cola
-- (limpieza de ruido y derecho de supresión del titular). Se devuelve solo el DELETE:
--   · UPDATE sigue revocado → un mensaje no se puede reescribir, que es lo que falsearía el rastro.
--   · Cada borrado queda en `audit_log` (append-only, sin UPDATE/DELETE) con actor, filtros y
--     conteos → el historial se puede depurar, pero la depuración misma no se puede ocultar.
--   · La aplicación protege además las conversaciones que respaldan un crédito APROBADO.
GRANT DELETE ON "conversation_message" TO app;
