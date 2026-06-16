import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  ConversationSummary,
  ConversationThreadOutput,
} from '@preztiaos/contracts';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { zoneScopePredicate } from '../iam/zone-scope';
import type { Session } from '../auth/require-role';

const THREAD_LIMIT = 500;

// Read model de la BANDEJA de WhatsApp: agrupa los mensajes por cliente y los scopea por la zona
// del usuario (ADMIN: todo; COORDINATOR: su(s) subárbol(es)). Solo lectura.
@Injectable()
export class ConversationsInboxQueryRepository {
  async listConversations(input: {
    session: Session;
    page: number;
    pageSize: number;
    search?: string;
    withApplication?: boolean;
  }): Promise<{ items: ConversationSummary[]; total: number }> {
    return withTenantTxFor(input.session.tenantId, async (tx) => {
      const conditions: SQL[] = [];
      const scope = zoneScopePredicate(input.session, sql`cm.zone_path`);
      if (scope) conditions.push(scope);
      if (input.search) {
        const like = `%${input.search}%`;
        conditions.push(
          sql`(cm.applicant_phone ILIKE ${like} OR cm.body ILIKE ${like})`,
        );
      }
      if (input.withApplication) {
        conditions.push(
          sql`EXISTS (SELECT 1 FROM credit_application ca WHERE ca.applicant_phone = cm.applicant_phone)`,
        );
      }
      const whereSql = conditions.length
        ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
        : sql``;

      // Una fila por cliente: último mensaje (DISTINCT ON), conteo total y estado de solicitud.
      const rows = (await tx.execute(sql`
        SELECT * FROM (
          SELECT DISTINCT ON (cm.applicant_phone)
            cm.applicant_phone AS applicant_phone,
            cm.zone_path::text  AS zone_path,
            cm.direction        AS last_direction,
            cm.kind             AS last_kind,
            cm.body             AS last_body,
            cm.created_at       AS last_at,
            (SELECT count(*) FROM conversation_message c2 WHERE c2.applicant_phone = cm.applicant_phone) AS message_count,
            (SELECT status FROM credit_application caa WHERE caa.applicant_phone = cm.applicant_phone ORDER BY created_at DESC LIMIT 1) AS application_status
          FROM conversation_message cm
          ${whereSql}
          ORDER BY cm.applicant_phone, cm.created_at DESC
        ) t
        ORDER BY t.last_at DESC
        LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
      `)) as unknown as Array<{
        applicant_phone: string;
        zone_path: string | null;
        last_direction: 'INBOUND' | 'OUTBOUND';
        last_kind: string;
        last_body: string | null;
        last_at: string | Date;
        message_count: number | string;
        application_status: ConversationSummary['applicationStatus'];
      }>;

      const totalRes = (await tx.execute(sql`
        SELECT count(DISTINCT cm.applicant_phone)::int AS value
        FROM conversation_message cm ${whereSql}
      `)) as unknown as Array<{ value: number }>;

      const items: ConversationSummary[] = rows.map((r) => ({
        applicantPhone: r.applicant_phone,
        applicantPhoneMasked: maskPhone(r.applicant_phone),
        zonePath: r.zone_path ?? null,
        messageCount: Number(r.message_count),
        lastDirection: r.last_direction,
        lastKind: r.last_kind,
        lastBody: r.last_body ?? null,
        lastAt: new Date(r.last_at).toISOString(),
        applicationStatus: r.application_status ?? null,
      }));
      return { items, total: Number(totalRes[0]?.value ?? 0) };
    });
  }

  async getThread(input: {
    session: Session;
    phone: string;
  }): Promise<ConversationThreadOutput> {
    return withTenantTxFor(input.session.tenantId, async (tx) => {
      const scope = zoneScopePredicate(
        input.session,
        sql`${schema.conversationMessage.zonePath}`,
      );
      const where = and(
        eq(schema.conversationMessage.applicantPhone, input.phone),
        scope,
      );
      const rows = await tx
        .select({
          direction: schema.conversationMessage.direction,
          kind: schema.conversationMessage.kind,
          body: schema.conversationMessage.body,
          mimeType: schema.conversationMessage.mimeType,
          createdAt: schema.conversationMessage.createdAt,
        })
        .from(schema.conversationMessage)
        .where(where)
        .orderBy(asc(schema.conversationMessage.createdAt))
        .limit(THREAD_LIMIT);
      return {
        applicantPhone: input.phone,
        entries: rows.map((r) => ({
          direction: r.direction,
          kind: r.kind,
          body: r.body ?? null,
          mimeType: r.mimeType ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    });
  }
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return `••• ${phone.slice(-4)}`;
}
