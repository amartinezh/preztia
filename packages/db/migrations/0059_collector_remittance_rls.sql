-- Rendición del cobrador (Fase 2, ADR #41): aislamiento por tenant de `collector_remittance` (0058).
-- Escrita a mano: drizzle-kit no representa RLS, GRANT ni REVOKE en el esquema.

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`, purga de datos del tenant).
-- Las default privileges del init ya cubren tablas futuras; se reafirma explícitamente por robustez.
GRANT SELECT, INSERT, UPDATE ON "collector_remittance" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "collector_remittance" TO platform;--> statement-breakpoint

-- Una rendición es evidencia de dinero entregado: cambia de estado (SUBMITTED → RECEIVED) pero
-- nunca se borra desde la app. Solo la purga del tenant (rol `platform`) puede eliminarla.
REVOKE DELETE ON "collector_remittance" FROM app;--> statement-breakpoint

-- RLS de aislamiento por tenant (ENABLE + FORCE + POLICY, como el resto del esquema). Sin esto,
-- un tenant podría leer o recibir las rendiciones y deudas de los cobradores de otro.
ALTER TABLE "collector_remittance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collector_remittance" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "collector_remittance"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
