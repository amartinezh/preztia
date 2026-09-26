-- Liquidación por períodos (Fase 6, ADR #41): aislamiento por tenant de `settlement_period` (0065).
-- Escrita a mano: drizzle-kit no representa RLS, GRANT ni REVOKE en el esquema.

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`: cron cross-tenant y purga).
GRANT SELECT, INSERT ON "settlement_period" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "settlement_period" TO platform;--> statement-breakpoint

-- La fotografía de un período cerrado NO cambia: ni se edita ni se borra desde la app. Una
-- corrección posterior cae sola en el período siguiente (el libro es append-only).
REVOKE UPDATE, DELETE ON "settlement_period" FROM app;--> statement-breakpoint

-- RLS de aislamiento por tenant (ENABLE + FORCE + POLICY, como el resto del esquema). Sin esto, un
-- tenant podría leer la tesorería y la utilidad de otro.
ALTER TABLE "settlement_period" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlement_period" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "settlement_period"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
