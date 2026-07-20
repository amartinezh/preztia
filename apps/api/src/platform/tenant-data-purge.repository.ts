import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PurgeCounts, TenantDataPurger } from '@preztiaos/application';
import { withPlatformTx } from './platform-uow';

/**
 * Orden de borrado FK-seguro: los HIJOS antes que sus PADRES. Solo importan las ~claves
 * foráneas reales del esquema (la mayoría de relaciones no tienen constraint), por eso el
 * orden es tolerante. Estas son las tablas TRANSACCIONALES de un tenant; NO se listan las
 * de CONFIGURACIÓN que se conservan (tenant, app_user, tenant_config, zone, zone_coordinator,
 * whatsapp_channel, tenant_bank_account, bank_credential, payment_plan,
 * credit_document_requirement).
 *
 * Al agregar una tabla de negocio nueva, decide si es transaccional (agrégala aquí, en el
 * lugar que respete sus FKs) o de configuración (déjala fuera).
 */
const PURGE_ORDER: readonly string[] = [
  // Referencian pagos/créditos/caja/cuotas → van primero.
  'cash_transaction', // → cash_box, payment, expense
  'cash_count', // → cash_box
  'bank_reconciliation', // → cash_box
  'fraud_assessment', // → payment
  'incoming_credit', // → payment
  'payment_charge', // → payment, credit
  'payment_allocation', // → payment, installment
  'payment_event', // → payment
  // Agregados de dinero.
  'payment',
  'installment', // → credit
  'cash_box',
  'expense',
  'collection_note', // → credit, borrower
  'collection_visit', // → credit, borrower
  'credit',
  // Solicitud de crédito: hijas antes que la solicitud.
  'credit_application_document', // → credit_application
  'credit_application_event', // → credit_application
  'processed_inbound_message', // → credit_application
  'credit_application_rejection',
  'document_extraction',
  'document_validation',
  'credit_application',
  // Conversaciones, clientes y varios (sin FKs duras entre sí).
  'conversation_message',
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
