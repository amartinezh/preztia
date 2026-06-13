-- RLS de aislamiento por tenant en la tabla de reportes de validación documental
-- (mismo patrón que el resto de tablas: ENABLE + FORCE + POLICY tenant_isolation).

ALTER TABLE document_validation ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_validation FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_validation
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Reportes append-only: el rol de aplicación inserta y consulta, pero NO edita
-- ni borra veredictos antifraude (integridad del rastro para auditoría).
REVOKE UPDATE, DELETE ON document_validation FROM app;
