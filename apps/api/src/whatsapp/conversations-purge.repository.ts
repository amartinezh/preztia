import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type { ConversationFilters, DeletionResult } from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { zoneScopePredicate } from '../iam/zone-scope';
import type { Session } from '../auth/require-role';
import {
  enrichedConversationsCte,
  enrichedPredicates,
} from './conversation-scope.sql';

/**
 * Tope de conversaciones que una limpieza masiva retira por llamada. Acota la transacción (y
 * el bloqueo sobre las tablas) en tenants con historiales largos; la pantalla repite la
 * operación mientras queden registros, informando siempre cuántos se retiraron.
 */
const PURGE_LIMIT = 2000;

/**
 * Depuración de la bandeja de WhatsApp: retira conversaciones completas (mensajes + fallos
 * técnicos) una a una, por lotes o por filtro.
 *
 * Dos garantías que no se negocian:
 *  1. **Alcance**: solo se borra lo que el actor puede ver (RLS del tenant + subárbol de zonas).
 *     Un teléfono fuera de su alcance simplemente no existe para él y se ignora.
 *  2. **Evidencia KYC**: una conversación que respalda un crédito APROBADO no se borra nunca;
 *     se cuenta aparte como `skippedProtected`. Es el rastro de cómo se originó ese crédito.
 *
 * El QUIÉN/CUÁNDO de cada borrado queda en `audit_log` (append-only) por el interceptor global:
 * el historial se puede depurar, pero la depuración misma no se puede ocultar.
 */
@Injectable()
export class ConversationsPurgeRepository {
  /** Borrado explícito: una conversación o un lote seleccionado por el operador. */
  async deleteByPhones(input: {
    session: Session;
    phones: readonly string[];
  }): Promise<DeletionResult> {
    const { session } = input;
    return withTenantTxFor(session.tenantId, async (tx) => {
      const visible = await tx
        .selectDistinct({ phone: schema.conversationMessage.applicantPhone })
        .from(schema.conversationMessage)
        .where(
          and(
            inArray(schema.conversationMessage.applicantPhone, [
              ...input.phones,
            ]),
            zoneScopePredicate(
              session,
              sql`${schema.conversationMessage.zonePath}`,
            ),
          ),
        );
      const candidates = visible.map((row) => row.phone);
      if (candidates.length === 0) return emptyResult();

      const protectedPhones = await this.approvedPhones(tx, candidates);
      const deletable = candidates.filter((p) => !protectedPhones.has(p));
      return this.removeConversations(tx, session, deletable, {
        skippedProtected: protectedPhones.size,
      });
    });
  }

  /**
   * Limpieza masiva: retira todo lo que casa con los filtros que el operador tiene aplicados.
   * Reutiliza el MISMO read model del listado, así que no puede borrar algo distinto de lo
   * que está viendo en pantalla.
   */
  async purge(input: {
    session: Session;
    filters: ConversationFilters;
  }): Promise<DeletionResult> {
    const { session, filters } = input;
    return withTenantTxFor(session.tenantId, async (tx) => {
      const rows = (await tx.execute(sql`
        ${enrichedConversationsCte(session, filters)}
        SELECT e.applicant_phone AS phone, e.is_protected AS is_protected
        FROM enriched e
        ${enrichedPredicates(filters)}
        ORDER BY e.last_at ASC
        LIMIT ${PURGE_LIMIT}
      `)) as unknown as Array<{ phone: string; is_protected: boolean }>;

      const deletable = rows.filter((r) => !r.is_protected).map((r) => r.phone);
      const skippedProtected = rows.length - deletable.length;
      if (deletable.length === 0) {
        return { ...emptyResult(), skippedProtected };
      }
      return this.removeConversations(tx, session, deletable, {
        skippedProtected,
      });
    });
  }

  /** Teléfonos con un crédito ya aprobado: su conversación es evidencia y no se toca. */
  private async approvedPhones(
    tx: Tx,
    phones: readonly string[],
  ): Promise<Set<string>> {
    const rows = await tx
      .selectDistinct({ phone: schema.creditApplication.applicantPhone })
      .from(schema.creditApplication)
      .where(
        and(
          inArray(schema.creditApplication.applicantPhone, [...phones]),
          eq(schema.creditApplication.status, 'APPROVED'),
        ),
      );
    return new Set(rows.map((row) => row.phone));
  }

  /** Retira mensajes y fallos de las conversaciones indicadas, dentro del alcance del actor. */
  private async removeConversations(
    tx: Tx,
    session: Session,
    phones: readonly string[],
    counts: { skippedProtected: number },
  ): Promise<DeletionResult> {
    if (phones.length === 0) {
      return { ...emptyResult(), skippedProtected: counts.skippedProtected };
    }
    const list = [...phones];

    const messages = await tx
      .delete(schema.conversationMessage)
      .where(
        and(
          inArray(schema.conversationMessage.applicantPhone, list),
          zoneScopePredicate(
            session,
            sql`${schema.conversationMessage.zonePath}`,
          ),
        ),
      )
      .returning({ id: schema.conversationMessage.id });

    const failures = await tx
      .delete(schema.conversationFailure)
      .where(
        and(
          inArray(schema.conversationFailure.applicantPhone, list),
          zoneScopePredicate(
            session,
            sql`${schema.conversationFailure.zonePath}`,
          ),
        ),
      )
      .returning({ id: schema.conversationFailure.id });

    return {
      deletedConversations: list.length,
      deletedMessages: messages.length,
      deletedFailures: failures.length,
      skippedProtected: counts.skippedProtected,
    };
  }
}

function emptyResult(): DeletionResult {
  return {
    deletedConversations: 0,
    deletedMessages: 0,
    deletedFailures: 0,
    skippedProtected: 0,
  };
}
