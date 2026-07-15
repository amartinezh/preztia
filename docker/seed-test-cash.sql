-- Seed de CAJA/BANCA para PRUEBAS LOCALES: deja el tenant listo para DESEMBOLSAR.
--
-- Problema que resuelve: al aprobar una solicitud ("Aprobar y generar crédito") el modal pide
-- "Desembolsar desde" una caja/cuenta. Si no hay cajas CASH/BANK con saldo, muestra
-- "No hay cajas ni cuentas disponibles para desembolsar" y no deja aprobar.
--
-- Qué siembra (idempotente, repetible; usa los IDs fijos de abajo):
--   1. UNA cuenta bancaria Inter (BR).
--   2. UNA caja de CADA tipo: CASH (Caja Menor), BANK (Caja Inter → cuenta Inter), TRANSIT.
--   3. Un SALDO INICIAL (ADJUSTMENT IN) en las cajas CASH y BANK, para que haya fondos
--      suficientes que desembolsar en las pruebas. El saldo se deriva de Σ cash_transaction.
--
-- La moneda de las cajas se toma de tenant_config (BRL/COP), así coincide con el crédito.
-- NO toca tenant, zonas, usuarios, plan de pago ni el flujo de WhatsApp.
--
-- Ejecutar como el superusuario del contenedor (bypassa RLS):
--   docker exec -i preztiaos-pg psql -U preztia -d preztiaos < docker/seed-test-cash.sql
--
-- ⚠️ SOLO para entornos de desarrollo/prueba.

BEGIN;

-- Tenant de demo (mismo id que apps/api/scripts/seed-demo.ts).
\set tenant_id '00000000-0000-0000-0000-000000000001'

-- 1) Cuenta bancaria Inter (BR). La api_key va NULL (solo se necesita para sync/verificación).
--    ON CONFLICT DO NOTHING → re-ejecutar no duplica ni rompe por los índices únicos.
INSERT INTO tenant_bank_account
  (id, tenant_id, label, bank_name, account_number, country_code, bank_code, pix_key, unverified_policy)
VALUES
  ('b0000000-0000-4000-8000-000000000001', :'tenant_id', 'Inter Principal', 'Banco Inter',
   '0001-12345-6', 'BR', 'INTER', 'tesouraria@preztia.com.br', 'HOLD')
ON CONFLICT DO NOTHING;

-- 2) Una caja de cada tipo. La BANK queda ligada a una cuenta existente (CHECK: BANK ⇒ cuenta):
--    se resuelve DINÁMICAMENTE (prefiere Inter; si no, la cuenta más antigua del tenant), así
--    reutiliza la cuenta que ya haya sembrada en lugar de un id fijo. La moneda sale de
--    tenant_config para cuadrar con la del tenant.
INSERT INTO cash_box (id, tenant_id, type, name, currency, bank_account_id)
VALUES
  ('c0000000-0000-4000-8000-000000000001', :'tenant_id', 'CASH', 'Caja Menor',
   (SELECT currency FROM tenant_config WHERE tenant_id = :'tenant_id'), NULL),
  ('c0000000-0000-4000-8000-000000000002', :'tenant_id', 'BANK', 'Caja Inter',
   (SELECT currency FROM tenant_config WHERE tenant_id = :'tenant_id'),
   (SELECT id FROM tenant_bank_account
     WHERE tenant_id = :'tenant_id'
     ORDER BY (bank_code = 'INTER') DESC, created_at
     LIMIT 1)),
  ('c0000000-0000-4000-8000-000000000003', :'tenant_id', 'TRANSIT', 'Fondos en Tránsito',
   (SELECT currency FROM tenant_config WHERE tenant_id = :'tenant_id'), NULL)
ON CONFLICT DO NOTHING;

-- 3) Saldo inicial en las cajas que desembolsan (CASH y BANK): 100.000,00 en unidades menores
--    (10.000.000). Marcado por `reason` para que re-ejecutar NO vuelva a fondear (NOT EXISTS).
INSERT INTO cash_transaction
  (tenant_id, cash_box_id, direction, kind, amount_minor, currency, reason)
SELECT b.tenant_id, b.id, 'IN', 'ADJUSTMENT', 10000000, b.currency, 'Saldo inicial (seed de prueba)'
FROM cash_box b
WHERE b.tenant_id = :'tenant_id'
  AND b.type IN ('CASH', 'BANK')
  AND NOT EXISTS (
    SELECT 1 FROM cash_transaction t
    WHERE t.cash_box_id = b.id
      AND t.reason = 'Saldo inicial (seed de prueba)'
  );

COMMIT;

-- Verificación rápida del saldo por caja (Σ firmada por dirección).
SELECT b.name, b.type, b.currency,
       COALESCE(SUM(CASE WHEN t.direction = 'IN' THEN t.amount_minor ELSE -t.amount_minor END), 0) AS balance_minor
FROM cash_box b
LEFT JOIN cash_transaction t ON t.cash_box_id = b.id
WHERE b.tenant_id = '00000000-0000-0000-0000-000000000001'
GROUP BY b.name, b.type, b.currency
ORDER BY b.type;
