-- Seed de ZONA + CAJA/BANCA para un tenant: deja UNA zona, UNA caja de efectivo y UNA cuenta
-- PIX (PicPay de ejemplo). RESETEA por completo las cajas y cuentas bancarias previas.
--
-- Qué hace (todo en UNA transacción, repetible/idempotente):
--   0. BORRA todo lo previo de CAJAS y CUENTAS BANCARIAS del tenant: movimientos (cash_transaction),
--      arqueos (cash_count), conciliaciones (bank_reconciliation), cajas (cash_box) y cuentas
--      (tenant_bank_account). Al borrar las cuentas, PostgreSQL arrastra por ON DELETE CASCADE sus
--      credenciales (bank_credential), créditos entrantes (incoming_credit) y eventos de webhook
--      (provider_webhook_event).
--   1. Crea la ZONA raíz "Javier Andres Aristizabal Montoya" (idempotente por path).
--   2. Crea UNA cuenta bancaria PicPay de EJEMPLO (edítala luego con los datos reales).
--   3. Crea UNA caja CASH llamada "Efectivo".
--   4. (Opcional) Saldo de apertura de la caja Efectivo si opening_balance_minor > 0 (default 0).
--
-- La moneda de la caja se toma de tenant_config para cuadrar con la del tenant.
-- NO toca tenant, usuarios, plan de pago ni el flujo de WhatsApp.
--
-- Cómo ejecutar (como el superusuario del contenedor, que bypassa RLS):
--   LOCAL (docker-compose de desarrollo):
--     docker exec -i preztiaos-pg psql -U preztia -d preztiaos < docker/seed-test-cash.sql
--   SERVIDOR (docker-compose.prod.yml):
--     docker compose -f docker-compose.prod.yml exec -T postgres \
--       sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < docker/seed-test-cash.sql
--
-- ⚠️ DESTRUCTIVO para cajas/cuentas: borra TODO el histórico de tesorería del tenant. Solo para
--    (re)inicializar un tenant. Ajusta abajo tenant_id / los datos de PicPay antes de correrlo.

-- Tenant objetivo (mismo id que apps/api/scripts/seed-user.ts). Cámbialo si aplica a otro tenant.
\set tenant_id '00000000-0000-0000-0000-000000000001'
-- Saldo de apertura (en unidades menores) para la caja Efectivo. 0 = sin fondear (se ajusta luego
-- por la app). Ej.: 10000000 = 100.000,00 si quieres poder desembolsar de inmediato en pruebas.
\set opening_balance_minor 0

BEGIN;

-- 0) RESET de cajas y cuentas del tenant, en orden FK-seguro (hijos de cash_box primero; luego
--    las cajas; por último las cuentas, que CASCADEAN a credenciales/entrantes/webhooks).
DELETE FROM cash_transaction    WHERE tenant_id = :'tenant_id';
DELETE FROM cash_count          WHERE tenant_id = :'tenant_id';
DELETE FROM bank_reconciliation WHERE tenant_id = :'tenant_id';
DELETE FROM cash_box            WHERE tenant_id = :'tenant_id';
DELETE FROM tenant_bank_account WHERE tenant_id = :'tenant_id';

-- 1) Zona raíz. El `path` es una etiqueta ltree derivada del nombre (minúsculas, sin diacríticos,
--    separadores → "_"), igual que hace el dominio (toLabel). Guardado por NOT EXISTS: re-ejecutar
--    no la duplica ni la borra (la zona NO se toca en el reset).
INSERT INTO zone (id, tenant_id, parent_zone_id, path, name)
SELECT gen_random_uuid(), :'tenant_id', NULL,
       'javier_andres_aristizabal_montoya'::ltree, 'Javier Andres Aristizabal Montoya'
WHERE NOT EXISTS (
  SELECT 1 FROM zone
  WHERE tenant_id = :'tenant_id'
    AND path = 'javier_andres_aristizabal_montoya'::ltree
);

-- 2) Cuenta bancaria PicPay (EJEMPLO). PicPay: banco 380 / ISPB 22896431. provider_type='PICPAY'
--    selecciona el adaptador PIX de PicPay (cobranças webhook-driven, sin saldo por API).
--    Reemplaza pix_key / account_number / receiver_* por los datos REALES; el token estático del
--    webhook (api_key) se carga cifrado desde el panel de configuración, no aquí (va NULL).
INSERT INTO tenant_bank_account
  (id, tenant_id, label, bank_name, account_number, country_code, bank_code,
   provider_type, pix_key, receiver_tax_id, receiver_name, api_key, unverified_policy)
VALUES
  (gen_random_uuid(), :'tenant_id', 'PicPay Principal', 'PicPay', '0001-00012345-6', 'BR', 'PICPAY',
   'PICPAY', 'financeiro@tuempresa.com.br', NULL, NULL, NULL, 'HOLD');

-- 3) Caja de efectivo. CASH ⇒ bank_account_id NULL (lo exige el CHECK cash_box_bank_link_chk).
--    La moneda sale de tenant_config para cuadrar con la del tenant.
INSERT INTO cash_box (id, tenant_id, type, name, currency, bank_account_id)
VALUES
  (gen_random_uuid(), :'tenant_id', 'CASH', 'Efectivo',
   (SELECT currency FROM tenant_config WHERE tenant_id = :'tenant_id'), NULL);

-- 4) Saldo de apertura opcional (solo si opening_balance_minor > 0): asiento ADJUSTMENT IN en la
--    caja Efectivo. El saldo de la caja se deriva de Σ cash_transaction (no hay campo de saldo).
INSERT INTO cash_transaction
  (tenant_id, cash_box_id, direction, kind, amount_minor, currency, reason)
SELECT b.tenant_id, b.id, 'IN', 'ADJUSTMENT', :opening_balance_minor, b.currency, 'Saldo de apertura (seed)'
FROM cash_box b
WHERE b.tenant_id = :'tenant_id'
  AND b.type = 'CASH'
  AND :opening_balance_minor > 0;

COMMIT;

-- Verificación: zona creada, cuenta(s) y caja(s) con su saldo (Σ firmada por dirección).
SELECT 'zona' AS tipo, name AS detalle, path::text AS extra FROM zone
  WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
    AND path = 'javier_andres_aristizabal_montoya'::ltree
UNION ALL
SELECT 'cuenta', label, bank_name || ' / ' || provider_type FROM tenant_bank_account
  WHERE tenant_id = '00000000-0000-0000-0000-000000000001';

SELECT b.name, b.type, b.currency,
       COALESCE(SUM(CASE WHEN t.direction = 'IN' THEN t.amount_minor ELSE -t.amount_minor END), 0) AS balance_minor
FROM cash_box b
LEFT JOIN cash_transaction t ON t.cash_box_id = b.id
WHERE b.tenant_id = '00000000-0000-0000-0000-000000000001'
GROUP BY b.name, b.type, b.currency
ORDER BY b.type;
