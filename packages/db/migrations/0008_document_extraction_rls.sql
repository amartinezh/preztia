-- RLS de aislamiento por tenant en la tabla de extracción de documentos
-- (mismo patrón que el resto de tablas: ENABLE + FORCE + POLICY tenant_isolation).

ALTER TABLE document_extraction ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_extraction FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_extraction
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Trazabilidad append-only: el rol de aplicación inserta y consulta, pero NO edita
-- ni borra la información extraída (integridad del rastro para auditoría/antifraude).
-- El borrado por retención se hará luego con el rol propietario / lifecycle.
REVOKE UPDATE, DELETE ON document_extraction FROM app;
