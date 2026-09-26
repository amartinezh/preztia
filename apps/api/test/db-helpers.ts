import postgres from 'postgres';

// Cliente de SETUP/TEARDOWN para los tests de integración. Usa el rol `platform`
// (BYPASSRLS y sin el REVOKE append-only de `app`): puede sembrar y limpiar datos de
// cualquier tenant, incluido borrar asientos del libro mayor (que `app` no puede tocar).
// El código bajo prueba sigue corriendo como `app` (RLS real) vía APP_DATABASE_URL.
let client: ReturnType<typeof postgres> | null = null;

export function owner(): ReturnType<typeof postgres> {
  if (!client) {
    const url = process.env.PLATFORM_DATABASE_URL;
    if (!url)
      throw new Error(
        'PLATFORM_DATABASE_URL no configurado para tests de integración',
      );
    client = postgres(url);
  }
  return client;
}

/** Borra todo lo que un test pudo crear para un tenant (respeta el orden de FKs). */
export async function cleanupTenant(tenantId: string): Promise<void> {
  const sql = owner();
  await sql`DELETE FROM cash_transaction WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM bank_reconciliation WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM cash_count WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM collector_remittance WHERE tenant_id = ${tenantId}`;
  // payment_allocation referencia payment e installment: se borra antes que ambos.
  // Paradas de ruta referencian payment (cobro de la visita): antes que payment.
  await sql`DELETE FROM route_stop WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM collection_route WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM payment_allocation WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM payment_event WHERE tenant_id = ${tenantId}`;
  // fraud_assessment e incoming_credit referencian payment: se borran antes que payment.
  await sql`DELETE FROM fraud_assessment WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM incoming_credit WHERE tenant_id = ${tenantId}`;
  // Órdenes de consignación: la bitácora antes que la orden; ambas antes de las cajas.
  await sql`DELETE FROM field_order_event WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM field_order WHERE tenant_id = ${tenantId}`;
  // payment_charge (sesión de cobro) referencia payment: se borra antes que payment.
  await sql`DELETE FROM payment_charge WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM payment WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM installment WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM credit WHERE tenant_id = ${tenantId}`;
  // expense referencia la caja pagadora (paid_from_cash_box_id): se borra antes que cash_box.
  await sql`DELETE FROM expense WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM cash_box WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM bank_credential WHERE tenant_id = ${tenantId}`;
  await sql`DELETE FROM tenant_bank_account WHERE tenant_id = ${tenantId}`;
  // Sin esto, un canal de WhatsApp de prueba (índice único) queda ocupado y rompe la corrida siguiente.
  await sql`DELETE FROM tenant_config WHERE tenant_id = ${tenantId}`;
}

export async function closeOwner(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = null;
  }
}

/** ¿Hay una BD disponible para los tests de integración? */
export function hasDb(): boolean {
  return Boolean(
    process.env.APP_DATABASE_URL && process.env.PLATFORM_DATABASE_URL,
  );
}
