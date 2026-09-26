-- Órdenes de ruta (Fase 5, ADR #41): aislamiento por tenant de `collection_route` y `route_stop`
-- (0063). Escrita a mano: drizzle-kit no representa RLS, GRANT ni REVOKE en el esquema.

-- Permisos del plano de datos (rol `app`) y de control (rol `platform`, purga de datos del tenant).
-- Las default privileges del init ya cubren tablas futuras; se reafirma explícitamente por robustez.
GRANT SELECT, INSERT ON "collection_route" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "collection_route" TO platform;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "route_stop" TO app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "route_stop" TO platform;--> statement-breakpoint

-- El despacho es un hecho (quién ordenó qué y cuándo): no se edita ni se borra. La parada cambia de
-- estado (vista, liquidada, cancelada) pero nunca se borra: es la evidencia de la visita.
REVOKE UPDATE, DELETE ON "collection_route" FROM app;--> statement-breakpoint
REVOKE DELETE ON "route_stop" FROM app;--> statement-breakpoint

-- RLS de aislamiento por tenant (ENABLE + FORCE + POLICY, como el resto del esquema). Sin esto, un
-- tenant podría leer la dirección y el teléfono de los clientes de otro.
ALTER TABLE "collection_route" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collection_route" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "collection_route"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);--> statement-breakpoint

ALTER TABLE "route_stop" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "route_stop" FORCE  ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "route_stop"
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
