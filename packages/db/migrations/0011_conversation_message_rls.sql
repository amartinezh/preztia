-- RLS de aislamiento por tenant en el transcript de la conversación
-- (mismo patrón que el resto de tablas: ENABLE + FORCE + POLICY tenant_isolation).

ALTER TABLE conversation_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_message FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON conversation_message
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- El transcript es append-only: el rol de aplicación inserta y consulta, pero NO edita
-- ni borra la comunicación (integridad del rastro para auditoría).
REVOKE UPDATE, DELETE ON conversation_message FROM app;
