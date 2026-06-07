-- RLS de aislamiento por tenant en las tablas del slice de solicitud de crédito
-- (mismo patrón que el resto de tablas: ENABLE + FORCE + POLICY tenant_isolation).

ALTER TABLE credit_application ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_application FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_application
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

ALTER TABLE credit_application_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_application_document FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_application_document
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

ALTER TABLE processed_inbound_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_inbound_message FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON processed_inbound_message
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

ALTER TABLE credit_application_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_application_event FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_application_event
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- La bitácora es append-only: el rol de aplicación no puede modificar ni borrar
-- historial financiero/KYC (solo INSERT y SELECT bajo RLS).
REVOKE UPDATE, DELETE ON credit_application_event FROM app;
