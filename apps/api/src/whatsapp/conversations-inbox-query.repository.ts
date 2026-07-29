import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  ConversationFilters,
  ConversationOutcome,
  ConversationSort,
  ConversationStatsOutput,
  ConversationSummary,
  ConversationThreadOutput,
  OutcomeBreakdown,
} from '@preztiaos/contracts';
import {
  classifyConversationOutcome,
  isProtectedFromDeletion,
} from '@preztiaos/domain';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { zoneScopePredicate } from '../iam/zone-scope';
import type { Session } from '../auth/require-role';
import {
  enrichedConversationsCte,
  enrichedPredicates,
} from './conversation-scope.sql';

const THREAD_LIMIT = 500;

// Columnas por las que se puede ordenar. La lista blanca es lo que hace segura la
// interpolación literal del ORDER BY (el valor ya viene acotado por el enum del contrato).
const SORT_COLUMN: Record<ConversationSort, string> = {
  lastAt: 'last_at',
  firstAt: 'first_at',
  messageCount: 'message_count',
  failures: 'failure_count',
  phone: 'applicant_phone',
};

const EMPTY_BREAKDOWN: OutcomeBreakdown = {
  ONLY_INQUIRY: 0,
  TECHNICAL_FAILURE: 0,
  INCOMPLETE: 0,
  PENDING_APPROVAL: 0,
  APPROVED: 0,
  REJECTED: 0,
};

interface ConversationRow {
  applicant_phone: string;
  channel_id: string;
  zone_path: string | null;
  first_at: string | Date;
  last_at: string | Date;
  message_count: number;
  inbound_count: number;
  outbound_count: number;
  last_direction: 'INBOUND' | 'OUTBOUND';
  last_kind: string;
  last_body: string | null;
  application_id: string | null;
  application_status: ConversationSummary['applicationStatus'];
  requested_amount_minor: string | number | null;
  failure_count: number;
  last_failure_at: string | Date | null;
  last_failure_stage: ConversationSummary['lastFailureStage'];
  last_failure_message: string | null;
  is_protected: boolean;
  outcome: ConversationOutcome;
}

/**
 * Read model de la BANDEJA de WhatsApp: agrupa los mensajes por cliente, los clasifica por
 * desenlace y los scopea por la zona del usuario (ADMIN: todo; COORDINATOR: su(s) subárbol(es)).
 * Solo lectura; la depuración vive en `ConversationsPurgeRepository`.
 */
@Injectable()
export class ConversationsInboxQueryRepository {
  async listConversations(input: {
    session: Session;
    filters: ConversationFilters;
    sort: ConversationSort;
    order: 'asc' | 'desc';
    page: number;
    pageSize: number;
  }): Promise<{ items: ConversationSummary[]; total: number }> {
    const { session, filters } = input;
    return withTenantTxFor(session.tenantId, async (tx) => {
      const cte = enrichedConversationsCte(session, filters);
      const where = enrichedPredicates(filters);
      const orderBy = sql.raw(
        `${SORT_COLUMN[input.sort]} ${input.order === 'asc' ? 'ASC' : 'DESC'}`,
      );

      const rows = (await tx.execute(sql`
        ${cte}
        SELECT * FROM enriched e
        ${where}
        ORDER BY ${orderBy}
        LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
      `)) as unknown as ConversationRow[];

      const totals = (await tx.execute(sql`
        ${cte}
        SELECT count(*)::int AS value FROM enriched e ${where}
      `)) as unknown as Array<{ value: number }>;

      return {
        items: rows.map(toSummary),
        total: Number(totals[0]?.value ?? 0),
      };
    });
  }

  /**
   * Estadística de la cola: cuántas conversaciones cayeron en cada desenlace y cuánto tráfico
   * hubo. Responde a los mismos filtros que el listado (menos `outcome`), así que los conteos
   * siempre cuadran con lo que el operador ve al pulsar cada categoría.
   */
  async stats(input: {
    session: Session;
    filters: ConversationFilters;
  }): Promise<ConversationStatsOutput> {
    const { session, filters } = input;
    return withTenantTxFor(session.tenantId, async (tx) => {
      const cte = enrichedConversationsCte(session, filters);
      const where = enrichedPredicates(filters);

      const rows = (await tx.execute(sql`
        ${cte}
        SELECT
          e.outcome                    AS outcome,
          count(*)::int                AS conversations,
          sum(e.message_count)::int    AS messages,
          sum(e.inbound_count)::int    AS inbound,
          sum(e.outbound_count)::int   AS outbound,
          sum(e.failure_count)::int    AS failures
        FROM enriched e
        ${where}
        GROUP BY e.outcome
      `)) as unknown as Array<{
        outcome: ConversationOutcome;
        conversations: number;
        messages: number;
        inbound: number;
        outbound: number;
        failures: number;
      }>;

      const byOutcome: OutcomeBreakdown = { ...EMPTY_BREAKDOWN };
      const stats: ConversationStatsOutput = {
        totalConversations: 0,
        totalMessages: 0,
        inboundMessages: 0,
        outboundMessages: 0,
        failedMessages: 0,
        byOutcome,
      };
      for (const row of rows) {
        byOutcome[row.outcome] = Number(row.conversations);
        stats.totalConversations += Number(row.conversations);
        stats.totalMessages += Number(row.messages);
        stats.inboundMessages += Number(row.inbound);
        stats.outboundMessages += Number(row.outbound);
        stats.failedMessages += Number(row.failures);
      }
      return stats;
    });
  }

  /** Hilo completo con un cliente: mensajes + los fallos técnicos, para intercalarlos. */
  async getThread(input: {
    session: Session;
    phone: string;
  }): Promise<ConversationThreadOutput> {
    return withTenantTxFor(input.session.tenantId, async (tx) => {
      const messages = await tx
        .select({
          direction: schema.conversationMessage.direction,
          kind: schema.conversationMessage.kind,
          body: schema.conversationMessage.body,
          mimeType: schema.conversationMessage.mimeType,
          createdAt: schema.conversationMessage.createdAt,
        })
        .from(schema.conversationMessage)
        .where(
          scopedTo(
            input.session,
            sql`${schema.conversationMessage.zonePath}`,
            eq(schema.conversationMessage.applicantPhone, input.phone),
          ),
        )
        .orderBy(asc(schema.conversationMessage.createdAt))
        .limit(THREAD_LIMIT);

      const failures = await tx
        .select({
          stage: schema.conversationFailure.stage,
          messageKind: schema.conversationFailure.messageKind,
          errorName: schema.conversationFailure.errorName,
          errorMessage: schema.conversationFailure.errorMessage,
          createdAt: schema.conversationFailure.createdAt,
        })
        .from(schema.conversationFailure)
        .where(
          scopedTo(
            input.session,
            sql`${schema.conversationFailure.zonePath}`,
            eq(schema.conversationFailure.applicantPhone, input.phone),
          ),
        )
        .orderBy(asc(schema.conversationFailure.createdAt))
        .limit(THREAD_LIMIT);

      return {
        applicantPhone: input.phone,
        entries: messages.map((m) => ({
          direction: m.direction,
          kind: m.kind,
          body: m.body ?? null,
          mimeType: m.mimeType ?? null,
          createdAt: m.createdAt.toISOString(),
        })),
        failures: failures.map((f) => ({
          stage: f.stage,
          messageKind: f.messageKind,
          errorName: f.errorName,
          errorMessage: f.errorMessage,
          createdAt: f.createdAt.toISOString(),
        })),
      };
    });
  }
}

/** Combina el predicado del caso de uso con el alcance de zona del actor. */
function scopedTo(
  session: Session,
  zoneColumn: SQL,
  predicate: SQL,
): SQL | undefined {
  return and(predicate, zoneScopePredicate(session, zoneColumn));
}

function toSummary(row: ConversationRow): ConversationSummary {
  return {
    applicantPhone: row.applicant_phone,
    applicantPhoneMasked: maskPhone(row.applicant_phone),
    channelId: row.channel_id,
    zonePath: row.zone_path ?? null,
    messageCount: Number(row.message_count),
    inboundCount: Number(row.inbound_count),
    outboundCount: Number(row.outbound_count),
    firstAt: new Date(row.first_at).toISOString(),
    lastAt: new Date(row.last_at).toISOString(),
    lastDirection: row.last_direction,
    lastKind: row.last_kind,
    lastBody: row.last_body ?? null,
    applicationId: row.application_id ?? null,
    applicationStatus: row.application_status ?? null,
    requestedAmountMinor:
      row.requested_amount_minor === null
        ? null
        : Number(row.requested_amount_minor),
    failureCount: Number(row.failure_count),
    lastFailureAt: row.last_failure_at
      ? new Date(row.last_failure_at).toISOString()
      : null,
    lastFailureStage: row.last_failure_stage ?? null,
    lastFailureMessage: row.last_failure_message ?? null,
    // El desenlace que sale por el API lo decide SIEMPRE el dominio; el `CASE` del SQL es una
    // transcripción de la misma regla que solo existe para poder filtrar y agregar en la BD.
    outcome: classifyConversationOutcome({
      applicationStatus: row.application_status,
      failureCount: Number(row.failure_count),
    }),
    protected: isProtectedFromDeletion(row.application_status),
  };
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return `••• ${phone.slice(-4)}`;
}
