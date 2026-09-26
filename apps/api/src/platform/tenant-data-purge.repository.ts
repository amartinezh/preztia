import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PurgeCounts, TenantDataPurger } from '@preztiaos/application';
import { withPlatformTx } from './platform-uow';

/**
 * Orden de borrado FK-seguro: los HIJOS antes que sus PADRES. Solo importan las ~claves
 * foráneas reales del esquema (la mayoría de relaciones no tienen constraint), por eso el
 * orden es tolerante. Estas son las tablas TRANSACCIONALES de un tenant; las de
 * CONFIGURACIÓN que se conservan están en `RETAINED_TENANT_TABLES`.
 *
 * Al agregar una tabla de negocio nueva, decide si es transaccional (agrégala aquí, en el
 * lugar que respete sus FKs) o de configuración (agrégala a `RETAINED_TENANT_TABLES`). La
 * prueba `tenant-data-purge.spec.ts` falla si una tabla con `tenant_id` no está en ninguna de
 * las dos listas o si el orden viola una clave foránea.
 */
export const PURGE_ORDER: readonly string[] = [
  // Referencian pagos/créditos/caja/cuotas → van primero.
  'cash_transaction', // → cash_box, payment, expense
  'cash_count', // → cash_box
  'collector_remittance', // → cash_box
  'bank_reconciliation', // → cash_box
  'fraud_assessment', // → payment
  'incoming_credit', // → payment, field_order
  'field_order_event', // → field_order
  'field_order', // → cash_box (ruta y destino)
  'payment_charge', // → payment, credit
  'payment_allocation', // → payment, installment
  'payment_event', // → payment
  // Agregados de dinero.
  'payment',
  'installment', // → credit
  'expense', // → cash_box (caja pagadora)
  'cash_box',
  'collection_note', // → credit, borrower
  'collection_visit', // → credit, borrower
  'credit',
  // Solicitud de crédito: hijas antes que la solicitud.
  'credit_application_document_file', // → credit_application (archivos KYC, ADR #38)
  'credit_application_document', // → credit_application
  'credit_application_event', // → credit_application
  'processed_inbound_message', // → credit_application
  'credit_application_rejection',
  'document_extraction',
  'document_validation',
  'credit_application',
  // Conversaciones, clientes y varios (sin FKs duras entre sí).
  'conversation_message',
  'conversation_failure', // bitácora de fallos de atención (misma vida que el transcript)
  'telegram_chat_link', // vínculo chat de Telegram ⇄ teléfono (PII del cliente)
  'borrower_list_member',
  'borrower_list',
  'borrower_note',
  'borrower_contact',
  'collector_client',
  'collector_location',
  'borrower',
  'change_request',
  'provider_webhook_event',
  'idempotency_key',
  // Auditoría al final (es historial de todo lo anterior).
  'audit_log',
];

/** Tablas de CONFIGURACIÓN del tenant: la purga de datos de prueba las conserva. */
export const RETAINED_TENANT_TABLES: readonly string[] = [
  'tenant_config',
  'app_user',
  'zone',
  'zone_coordinator',
  'whatsapp_channel',
  'telegram_channel',
  'tenant_bank_account',
  'bank_credential',
  'payment_plan',
  'credit_document_requirement',
];

/**
 * Adaptador del puerto `TenantDataPurger`: borra en UNA transacción del plano de control
 * (BYPASSRLS) todas las filas transaccionales del tenant, en orden FK-seguro. Atómico: si
 * algo falla, no se borra nada. Conserva el tenant, sus usuarios y su configuración.
 */
@Injectable()
export class TenantDataPurgeRepository implements TenantDataPurger {
  async purge(tenantId: string): Promise<PurgeCounts> {
    return withPlatformTx(async (tx) => {
      const counts: Record<string, number> = {};
      for (const table of PURGE_ORDER) {
        const result = await tx.execute(
          sql`DELETE FROM ${sql.identifier(table)} WHERE tenant_id = ${tenantId}`,
        );
        counts[table] = affectedRows(result);
      }
      return counts;
    });
  }
}

/**
 * postgres.js devuelve el `RowList` con la cantidad de filas afectadas en `.count` (un
 * DELETE sin RETURNING trae `length` 0 pero `count` correcto). Se lee de forma defensiva.
 */
function affectedRows(result: unknown): number {
  const count = (result as { count?: number } | null)?.count;
  return typeof count === 'number' ? count : 0;
}
