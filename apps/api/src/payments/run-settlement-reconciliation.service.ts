import { Logger } from '@nestjs/common';
import {
  allocatePayment,
  matchCreditsToClaims,
  Money,
  type ReceiptClaimRef,
} from '@preztiaos/domain';
import {
  type PaymentAuditEvent,
  type SettlementSource,
  type SettlementWindow,
} from '@preztiaos/application';
import type { OutboundTextSender } from '@preztiaos/application';
import {
  IncomingCreditDrizzleRepository,
  type SettlementAccount,
} from './incoming-credit.repository';
import { PaymentReconciliationDrizzleRepository } from './payment-reconciliation.repository';
import { SettlementReviewSettingsReader } from './settlement-review-settings.reader';

const CLAIMS_PAGE_SIZE = 200;
const DEFAULT_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SettlementReconciliationSummary {
  readonly processed: number;
  /** Matches abonados automáticamente (toggle autoConfirmSettlement ON). */
  readonly confirmed: number;
  /** Matches reservados a la espera de aprobación humana (toggle OFF = default). */
  readonly pendingReview: number;
  /** Comprobantes que no encontraron crédito real en la ventana. */
  readonly unconfirmed: number;
}

/** Comprobante pendiente con su monto único esperado (claim) y datos para abonar/notificar. */
interface PendingClaim {
  readonly id: string;
  readonly amountMinor: number;
  readonly endToEndId: string | null;
  readonly creditId: string | null;
  readonly channelId: string | null;
  readonly payerPhone: string;
}

/**
 * Ciclo de conciliación de la Fase 2 (settlement): para CADA cuenta con fuente de liquidación
 * habilitada (Mercado Pago: reporte batch; PicPay: webhooks PAID ya ingeridos), trae/ingiere los
 * créditos (idempotente) y empareja los comprobantes UNVERIFIED — primero por E2E, luego por
 * MONTO ÚNICO. Con match → consume el crédito y CONFIRMA el pago en una transacción (recién aquí
 * se libera); sin match → el comprobante queda UNCONFIRMED (no se libera). La IA nunca confirma:
 * solo el crédito real lo hace (I6). Se invoca desde el endpoint, el webhook de PicPay (con
 * `refresh: false`: concilia solo lo ya ingerido, sin golpear las APIs) o un cron por tenant.
 */
export class RunSettlementReconciliationService {
  private readonly logger = new Logger('Payments:SettlementReconciliation');

  constructor(
    private readonly source: SettlementSource,
    private readonly credits: IncomingCreditDrizzleRepository,
    private readonly reconciliation: PaymentReconciliationDrizzleRepository,
    private readonly sender: OutboundTextSender,
    private readonly settings: SettlementReviewSettingsReader,
  ) {}

  async execute(cmd: {
    tenantId: string;
    /** false = no traer créditos frescos de la fuente (usar solo lo ya ingerido). */
    refresh?: boolean;
  }): Promise<SettlementReconciliationSummary> {
    const accounts = await this.credits.listSettlementAccounts(cmd.tenantId);
    if (accounts.length === 0) {
      return { processed: 0, confirmed: 0, pendingReview: 0, unconfirmed: 0 };
    }

    // Toggle del tenant: ON = abona el match de inmediato; OFF (default) = lo reserva para
    // aprobación humana. Los pagos que YA tienen un crédito reservado se excluyen (una reserva
    // por pago): siguen pendientes de que el humano los apruebe, no se re-tocan.
    const autoConfirm = await this.settings.autoConfirm(cmd.tenantId);
    const loaded = await this.loadPendingClaims(cmd.tenantId);
    const reserved = await this.credits.paymentsWithReservedCredit({
      tenantId: cmd.tenantId,
      paymentIds: loaded.map((c) => c.id),
    });
    let claims = loaded.filter((c) => !reserved.has(c.id));
    const processed = claims.length;
    let confirmed = 0;
    let pendingReview = 0;

    for (const account of accounts) {
      if (claims.length === 0) break;

      // 1) Poblar el ground truth de la cuenta (idempotente). PicPay ingiere por webhook: su
      //    fuente degrada a lista vacía y se concilia con lo ya ingerido.
      if (cmd.refresh !== false) {
        await this.ingestFresh(cmd.tenantId, account);
      }

      // 2) Créditos disponibles de la cuenta y match puro (E2E primero, luego monto único).
      const available = await this.credits.listUnconsumed({
        tenantId: cmd.tenantId,
        bankAccountId: account.bankAccountId,
      });
      const claimRefs: ReceiptClaimRef[] = claims.map((c) => ({
        id: c.id,
        amountMinor: c.amountMinor,
        endToEndId: c.endToEndId,
      }));
      const result = matchCreditsToClaims(claimRefs, available);
      const byId = new Map(claims.map((c) => [c.id, c]));

      // 3) Por cada match: si autoConfirm, abona (consume + verifica, atómico); si no, reserva el
      //    crédito y deja el pago "pendiente de aprobación". En ambos casos se saca de la lista.
      const settledIds = new Set<string>();
      for (const match of result.matches) {
        const claim = byId.get(match.claimId);
        if (!claim) continue;
        if (autoConfirm) {
          if (
            await this.confirmMatch(
              cmd.tenantId,
              claim,
              match.sourceId,
              match.amountMinor,
            )
          ) {
            confirmed++;
            settledIds.add(claim.id);
          }
        } else if (
          await this.reserveMatch(
            cmd.tenantId,
            claim,
            match.sourceId,
            match.amountMinor,
          )
        ) {
          pendingReview++;
          settledIds.add(claim.id);
        }
      }
      claims = claims.filter((c) => !settledIds.has(c.id));
    }

    return {
      processed,
      confirmed,
      pendingReview,
      unconfirmed: processed - confirmed - pendingReview,
    };
  }

  private async ingestFresh(
    tenantId: string,
    account: SettlementAccount,
  ): Promise<void> {
    try {
      const window = windowFor(tenantId, account);
      const fetched = await this.source.fetchCredits(window);
      if (fetched.length) {
        await this.credits.ingestMany({
          tenantId,
          bankAccountId: account.bankAccountId,
          credits: fetched,
        });
      }
    } catch (err) {
      // El reporte puede no estar disponible aún; se concilia con lo ya ingerido (webhook).
      this.logger.warn(
        `No se pudo traer el reporte fresco del tenant ${tenantId}; se concilia con lo ingerido: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async loadPendingClaims(tenantId: string): Promise<PendingClaim[]> {
    const claims: PendingClaim[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.reconciliation.listUnverified({
        tenantId,
        limit: CLAIMS_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      });
      for (const payment of page.items) {
        // Sin monto extraído no se puede emparejar por monto único.
        if (payment.pix.amountMinor === null) continue;
        claims.push({
          id: payment.id,
          amountMinor: payment.pix.amountMinor,
          endToEndId: payment.pix.endToEndId,
          creditId: payment.creditId,
          channelId: payment.channelId,
          payerPhone: payment.payerPhone,
        });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return claims;
  }

  private async confirmMatch(
    tenantId: string,
    claim: PendingClaim,
    sourceId: string,
    creditAmountMinor: number,
  ): Promise<boolean> {
    // Sin crédito activo asociado no hay cartera que abonar: se deja para revisión manual.
    const portfolio = claim.creditId
      ? await this.reconciliation.loadPortfolio({
          tenantId,
          creditId: claim.creditId,
        })
      : null;
    if (!portfolio) return false;

    // Se abona el monto del CRÉDITO real (en el match por E2E puede diferir del extraído).
    const allocation = allocatePayment(
      portfolio.currency,
      portfolio.installments,
      Money.of(creditAmountMinor, portfolio.currency),
    );
    const events: PaymentAuditEvent[] = [
      {
        type: 'payment_confirmed_by_settlement',
        payload: { creditId: portfolio.creditId, sourceId },
      },
      {
        type: 'payment_allocated',
        payload: {
          creditId: portfolio.creditId,
          allocations: allocation.allocations.map((a) => ({ ...a })),
        },
      },
    ];
    if (allocation.creditSettled) {
      events.push({
        type: 'credit_settled',
        payload: { creditId: portfolio.creditId },
      });
    }

    const { confirmed } = await this.reconciliation.confirmWithCredit({
      tenantId,
      paymentId: claim.id,
      creditSourceId: sourceId,
      allocation,
      events,
    });
    if (!confirmed) return false;

    if (claim.channelId) {
      const body = allocation.creditSettled
        ? '✅ Tu pago fue confirmado. 🎉 ¡Tu crédito quedó *saldado*!'
        : '✅ Tu pago fue confirmado.';
      await this.sender.sendText(
        { channelId: claim.channelId, recipient: claim.payerPhone },
        body,
      );
    }
    return true;
  }

  /**
   * Conciliación MANUAL (toggle OFF): reserva el crédito para el comprobante SIN abonar. El pago
   * queda "pendiente de aprobación" para un humano; NO se notifica al cliente "confirmado" (aún no
   * lo está). Devuelve true si la reserva se hizo efectiva.
   */
  private async reserveMatch(
    tenantId: string,
    claim: PendingClaim,
    sourceId: string,
    creditAmountMinor: number,
  ): Promise<boolean> {
    const { reserved } = await this.reconciliation.reserveCreditForReview({
      tenantId,
      paymentId: claim.id,
      creditSourceId: sourceId,
      creditAmountMinor,
    });
    return reserved;
  }
}

function windowFor(
  tenantId: string,
  account: { countryCode: string; bankCode: string; windowDays: number | null },
): SettlementWindow {
  const end = new Date();
  const days =
    account.windowDays && account.windowDays > 0
      ? account.windowDays
      : DEFAULT_WINDOW_DAYS;
  const begin = new Date(end.getTime() - days * MS_PER_DAY);
  return {
    tenantId,
    countryCode: account.countryCode,
    bankCode: account.bankCode,
    begin: begin.toISOString(),
    end: end.toISOString(),
  };
}
