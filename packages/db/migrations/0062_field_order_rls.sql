-- Órdenes de consignación (Fase 4, ADR #41): aislamiento por tenant de `field_order` y
-- `field_order_event` (0061). Escrita a mano: drizzle-kit no representa RLS, GRANT ni REVOKE.

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`, purga de datos del tenant).
-- Las default privileges del init ya cubren tablas futuras; se reafirma explícitamente por robustez.
GRANT SELECT, INSERT, UPDATE ON "field_order" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "field_order" TO platform;--> statement-breakpoint
GRANT SELECT, INSERT ON "field_order_event" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "field_order_event" TO platform;--> statement-breakpoint

-- La orden cambia de estado pero nunca se borra desde la app (evidencia del dinero en la calle).
REVOKE DELETE ON "field_order" FROM app;--> statement-breakpoint
-- La bitácora es APPEND-ONLY: es la herramienta para aclarar cuadres; nadie la edita ni la borra.
REVOKE UPDATE, DELETE ON "field_order_event" FROM app;--> statement-breakpoint

-- RLS de aislamiento por tenant (ENABLE + FORCE + POLICY, como el resto del esquema). Sin esto,
-- un tenant podría leer o verificar las consignaciones de los cobradores de otro.
ALTER TABLE "field_order" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "field_order" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "field_order"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint

ALTER TABLE "field_order_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "field_order_event" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "field_order_event"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
