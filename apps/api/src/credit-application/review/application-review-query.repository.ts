import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  ApplicationReviewDetail,
  ApplicationReviewSummary,
  ConversationEntry,
  CreditApplicationStatus,
  RejectionSummary,
  ValidationRunView,
} from '@preztiaos/contracts';
import { withTenantTxFor } from '../../tenancy/unit-of-work';
import { zoneScopePredicate } from '../../iam/zone-scope';
import type { Session } from '../../auth/require-role';

// Predicado de alcance por zona sobre `credit_application.zone_path` (ADMIN: sin filtro).
function applicationScope(session: Session): SQL | undefined {
  return zoneScopePredicate(session, sql`${schema.creditApplication.zonePath}`);
}

// Tope de mensajes del transcript para no traer conversaciones ilimitadas (rendimiento).
const CONVERSATION_LIMIT = 500;

/**
 * Read model de la revisión antifraude de cartera. SOLO lectura, sin reglas de negocio.
 * Materializa, bajo RLS: el listado paginado de intentos con su veredicto vigente, el
 * detalle completo de un expediente (documentos + historial append-only de veredictos) y
 * el transcript de la conversación. El teléfono se enmascara en el listado (privacidad) y
 * se muestra completo solo en el detalle (el coordinador está autorizado).
 */
@Injectable()
export class ApplicationReviewQueryRepository {
  async listApplications(input: {
    session: Session;
    page: number;
    pageSize: number;
    status?: CreditApplicationStatus;
  }): Promise<{ items: ApplicationReviewSummary[]; total: number }> {
    return withTenantTxFor(input.session.tenantId, async (tx) => {
      const conditions = [
        applicationScope(input.session),
        input.status
          ? eq(schema.creditApplication.status, input.status)
          : undefined,
      ].filter((c): c is SQL => c !== undefined);
      const where = conditions.length ? and(...conditions) : undefined;

      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.creditApplication)
        .where(where);

      const apps = await tx
        .select({
          id: schema.creditApplication.id,
          applicantPhone: schema.creditApplication.applicantPhone,
          status: schema.creditApplication.status,
          createdAt: schema.creditApplication.createdAt,
        })
        .from(schema.creditApplication)
        .where(where)
        .orderBy(desc(schema.creditApplication.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const appIds = apps.map((a) => a.id);
      const latestVerdict = await this.latestVerdictByApplication(tx, appIds);
      const docStats = await this.documentStatsByApplication(tx, appIds);

      const items: ApplicationReviewSummary[] = apps.map((a) => {
        const verdict = latestVerdict.get(a.id) ?? null;
        const stats = docStats.get(a.id) ?? { total: 0, flagged: 0 };
        return {
          id: a.id,
          applicantPhoneMasked: maskPhone(a.applicantPhone),
          status: a.status,
          latestVerdictStatus: verdict?.status ?? null,
          latestVerdictScore: verdict?.score ?? null,
          documentsTotal: stats.total,
          documentsFlagged: stats.flagged,
          createdAt: a.createdAt.toISOString(),
        };
      });
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }

  async getApplicationReview(input: {
    session: Session;
    applicationId: string;
  }): Promise<ApplicationReviewDetail | null> {
    return withTenantTxFor(input.session.tenantId, async (tx) => {
      const [app] = await tx
        .select({
          id: schema.creditApplication.id,
          applicantPhone: schema.creditApplication.applicantPhone,
          status: schema.creditApplication.status,
          createdAt: schema.creditApplication.createdAt,
          planOffer: schema.creditApplication.planOffer,
          offeredPlanId: schema.creditApplication.offeredPlanId,
          offeredPrincipalMinor: schema.creditApplication.offeredPrincipalMinor,
          offerExpiresAt: schema.creditApplication.offerExpiresAt,
          clientAcceptedAt: schema.creditApplication.clientAcceptedAt,
        })
        .from(schema.creditApplication)
        .where(
          and(
            eq(schema.creditApplication.id, input.applicationId),
            applicationScope(input.session),
          ),
        )
        .limit(1);
      if (!app) return null;

      // Plan ofertado (si lo hay): nombre + términos, para el detalle y para prellenar la creación.
      let offeredPlanName: string | null = null;
      let offeredPlanInstallments: number | null = null;
      let offeredPlanInterestPct: number | null = null;
      if (app.offeredPlanId) {
        const [planRow] = await tx
          .select({
            name: schema.paymentPlan.name,
            installmentsCount: schema.paymentPlan.installmentsCount,
            interestPct: schema.paymentPlan.interestPct,
          })
          .from(schema.paymentPlan)
          .where(eq(schema.paymentPlan.id, app.offeredPlanId))
          .limit(1);
        offeredPlanName = planRow?.name ?? null;
        offeredPlanInstallments = planRow?.installmentsCount ?? null;
        offeredPlanInterestPct = planRow?.interestPct ?? null;
      }

      const docs = await tx
        .select({
          documentType: schema.creditApplicationDocument.documentType,
          status: schema.creditApplicationDocument.status,
          fraudScore: schema.creditApplicationDocument.fraudScore,
          fraudReasons: schema.creditApplicationDocument.fraudReasons,
          manualReview: schema.creditApplicationDocument.manualReview,
          mimeType: schema.creditApplicationDocument.mimeType,
          storageKey: schema.creditApplicationDocument.storageKey,
        })
        .from(schema.creditApplicationDocument)
        .where(
          eq(
            schema.creditApplicationDocument.applicationId,
            input.applicationId,
          ),
        );

      const extractions = await this.latestExtractionByType(
        tx,
        input.applicationId,
      );

      const verdictRows = await tx
        .select({
          id: schema.documentValidation.id,
          status: schema.documentValidation.status,
          score: schema.documentValidation.score,
          alerts: schema.documentValidation.alerts,
          consultedSources: schema.documentValidation.consultedSources,
          createdAt: schema.documentValidation.createdAt,
        })
        .from(schema.documentValidation)
        .where(eq(schema.documentValidation.applicationId, input.applicationId))
        .orderBy(desc(schema.documentValidation.createdAt));

      const verdictHistory: ValidationRunView[] = verdictRows.map((v) => ({
        id: v.id,
        status: v.status,
        score: v.score,
        alerts: v.alerts.map((a) => ({
          documento: a.documento,
          campo: a.campo,
          severidad: a.severidad,
          detalle: a.detalle,
        })),
        consultedSources: v.consultedSources,
        createdAt: v.createdAt.toISOString(),
      }));

      return {
        id: app.id,
        applicantPhone: app.applicantPhone,
        status: app.status,
        createdAt: app.createdAt.toISOString(),
        documents: docs.map((d) => {
          const extraction = extractions.get(d.documentType);
          return {
            documentType: d.documentType,
            status: d.status,
            fraudScore: d.fraudScore ?? null,
            fraudReasons: d.fraudReasons ?? null,
            manualReview: d.manualReview,
            mimeType: d.mimeType ?? null,
            hasOriginal: d.storageKey != null,
            identifiedType: extraction?.identifiedType ?? null,
            matchesExpected: extraction?.matchesExpected ?? null,
            confidence: extraction?.confidence ?? null,
          };
        }),
        verdictHistory,
        planOffer: {
          status: app.planOffer,
          offeredPlanName,
          offeredPrincipalMinor: app.offeredPrincipalMinor ?? null,
          offeredPlanInstallments,
          offeredPlanInterestPct,
          offerExpiresAt: app.offerExpiresAt
            ? app.offerExpiresAt.toISOString()
            : null,
          clientAcceptedAt: app.clientAcceptedAt
            ? app.clientAcceptedAt.toISOString()
            : null,
        },
      };
    });
  }

  async getConversation(input: {
    session: Session;
    applicationId: string;
  }): Promise<{ entries: ConversationEntry[] } | null> {
    return withTenantTxFor(input.session.tenantId, async (tx) => {
      const [app] = await tx
        .select({ applicantPhone: schema.creditApplication.applicantPhone })
        .from(schema.creditApplication)
        .where(
          and(
            eq(schema.creditApplication.id, input.applicationId),
            applicationScope(input.session),
          ),
        )
        .limit(1);
      if (!app) return null;

      const rows = await tx
        .select({
          direction: schema.conversationMessage.direction,
          kind: schema.conversationMessage.kind,
          body: schema.conversationMessage.body,
          mimeType: schema.conversationMessage.mimeType,
          createdAt: schema.conversationMessage.createdAt,
        })
        .from(schema.conversationMessage)
        .where(
          eq(schema.conversationMessage.applicantPhone, app.applicantPhone),
        )
        .orderBy(asc(schema.conversationMessage.createdAt))
        .limit(CONVERSATION_LIMIT);

      const entries: ConversationEntry[] = rows.map((r) => ({
        direction: r.direction,
        kind: r.kind,
        body: r.body ?? null,
        mimeType: r.mimeType ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
      return { entries };
    });
  }

  async listRejections(input: {
    session: Session;
    page: number;
    pageSize: number;
  }): Promise<{ items: RejectionSummary[]; total: number }> {
    return withTenantTxFor(input.session.tenantId, async (tx) => {
      // Join a la solicitud para scopear por zona y enmascarar el teléfono.
      const where = applicationScope(input.session);
      const base = tx
        .select({
          id: schema.creditApplicationRejection.id,
          applicationId: schema.creditApplicationRejection.applicationId,
          reason: schema.creditApplicationRejection.reason,
          decidedBy: schema.creditApplicationRejection.decidedBy,
          createdAt: schema.creditApplicationRejection.createdAt,
          applicantPhone: schema.creditApplication.applicantPhone,
        })
        .from(schema.creditApplicationRejection)
        .innerJoin(
          schema.creditApplication,
          eq(
            schema.creditApplication.id,
            schema.creditApplicationRejection.applicationId,
          ),
        )
        .where(where);

      const [totalRow] = await tx
        .select({ value: count() })
        .from(schema.creditApplicationRejection)
        .innerJoin(
          schema.creditApplication,
          eq(
            schema.creditApplication.id,
            schema.creditApplicationRejection.applicationId,
          ),
        )
        .where(where);

      const rows = await base
        .orderBy(desc(schema.creditApplicationRejection.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const items: RejectionSummary[] = rows.map((r) => ({
        id: r.id,
        applicationId: r.applicationId,
        applicantPhoneMasked: maskPhone(r.applicantPhone),
        reason: r.reason,
        decidedBy: r.decidedBy,
        createdAt: r.createdAt.toISOString(),
      }));
      return { items, total: Number(totalRow?.value ?? 0) };
    });
  }

  // ── helpers de agregación (evitan N+1: una consulta por la página completa) ──

  private async latestVerdictByApplication(
    tx: Parameters<Parameters<typeof withTenantTxFor>[1]>[0],
    appIds: string[],
  ): Promise<
    Map<
      string,
      { status: ApplicationReviewSummary['latestVerdictStatus']; score: number }
    >
  > {
    const map = new Map<
      string,
      { status: ApplicationReviewSummary['latestVerdictStatus']; score: number }
    >();
    if (appIds.length === 0) return map;
    const rows = await tx
      .select({
        applicationId: schema.documentValidation.applicationId,
        status: schema.documentValidation.status,
        score: schema.documentValidation.score,
        createdAt: schema.documentValidation.createdAt,
      })
      .from(schema.documentValidation)
      .where(inArray(schema.documentValidation.applicationId, appIds))
      .orderBy(desc(schema.documentValidation.createdAt));
    for (const row of rows) {
      if (map.has(row.applicationId)) continue; // el primero = el más reciente
      map.set(row.applicationId, { status: row.status, score: row.score });
    }
    return map;
  }

  private async documentStatsByApplication(
    tx: Parameters<Parameters<typeof withTenantTxFor>[1]>[0],
    appIds: string[],
  ): Promise<Map<string, { total: number; flagged: number }>> {
    const map = new Map<string, { total: number; flagged: number }>();
    if (appIds.length === 0) return map;
    const rows = await tx
      .select({
        applicationId: schema.creditApplicationDocument.applicationId,
        fraudScore: schema.creditApplicationDocument.fraudScore,
        manualReview: schema.creditApplicationDocument.manualReview,
      })
      .from(schema.creditApplicationDocument)
      .where(inArray(schema.creditApplicationDocument.applicationId, appIds));
    for (const row of rows) {
      const current = map.get(row.applicationId) ?? { total: 0, flagged: 0 };
      const flagged = (row.fraudScore ?? 0) > 0 || row.manualReview ? 1 : 0;
      map.set(row.applicationId, {
        total: current.total + 1,
        flagged: current.flagged + flagged,
      });
    }
    return map;
  }

  private async latestExtractionByType(
    tx: Parameters<Parameters<typeof withTenantTxFor>[1]>[0],
    applicationId: string,
  ): Promise<
    Map<
      string,
      {
        identifiedType: string | null;
        matchesExpected: boolean | null;
        confidence: number | null;
      }
    >
  > {
    const rows = await tx
      .select({
        documentType: schema.documentExtraction.documentType,
        identifiedType: schema.documentExtraction.identifiedType,
        matchesExpected: schema.documentExtraction.matchesExpected,
        confidence: schema.documentExtraction.confidence,
        createdAt: schema.documentExtraction.createdAt,
      })
      .from(schema.documentExtraction)
      .where(eq(schema.documentExtraction.applicationId, applicationId))
      .orderBy(desc(schema.documentExtraction.createdAt));
    const map = new Map<
      string,
      {
        identifiedType: string | null;
        matchesExpected: boolean | null;
        confidence: number | null;
      }
    >();
    for (const row of rows) {
      if (map.has(row.documentType)) continue;
      map.set(row.documentType, {
        identifiedType: row.identifiedType ?? null,
        matchesExpected: row.matchesExpected ?? null,
        confidence: row.confidence ?? null,
      });
    }
    return map;
  }
}

/** Enmascara el teléfono dejando solo los últimos 4 dígitos (privacidad en listados). */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return `••• ${phone.slice(-4)}`;
}
