-- Índice GiST para consultas de subárbol (path <@ ...)
CREATE INDEX IF NOT EXISTS zone_path_gist ON zone USING GIST (path);
CREATE INDEX IF NOT EXISTS zone_tenant_idx ON zone (tenant_id);

-- Helper: activar RLS de aislamiento por tenant en una tabla
-- (repite el bloque por cada tabla con tenant_id)
ALTER TABLE zone ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON zone
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE credit ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE zone_coordinator ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone_coordinator FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON zone_coordinator
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);