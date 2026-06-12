-- RLS de aislamiento por tenant en el slice de pagos (PIX) y cartera
-- (mismo patrón que el resto de tablas: ENABLE + FORCE + POLICY tenant_isolation).

ALTER TABLE installment ENABLE ROW LEVEL SECURITY;
ALTER TABLE installment FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON installment
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

ALTER TABLE payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

ALTER TABLE payment_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocation FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_allocation
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

ALTER TABLE payment_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_event FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_event
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

ALTER TABLE borrower_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE borrower_contact FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON borrower_contact
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

ALTER TABLE tenant_bank_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_bank_account FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_bank_account
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
--> statement-breakpoint

-- Integridad financiera: la bitácora de pagos y las asignaciones a cuotas son
-- append-only — el rol de aplicación inserta y consulta, pero NO edita ni borra
-- movimientos de dinero (rastro de auditoría inmutable).
REVOKE UPDATE, DELETE ON payment_event FROM app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON payment_allocation FROM app;
