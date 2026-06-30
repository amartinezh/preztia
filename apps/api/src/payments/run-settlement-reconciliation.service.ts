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
import { IncomingCreditDrizzleRepository } from './incoming-credit.repository';
import { PaymentReconciliationDrizzleRepository } from './payment-reconciliation.repository';

const CLAIMS_PAGE_SIZE = 200;
const DEFAULT_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SettlementReconciliationSummary {
  readonly processed: number;
  readonly confirmed: number;
  readonly unconfirmed: number;
}

/** Comprobante pendiente con su monto único esperado (claim) y datos para abonar/notificar. */
interface PendingClaim {
  readonly id: string;
  readonly amountMinor: number;
  readonly creditId: string | null;
  readonly channelId: string | null;
  readonly payerPhone: string;
}

/**
 * Ciclo de conciliación de la Fase 2 (settlement): trae los créditos reales del proveedor, los
 * ingiere (idempotente) y empareja los comprobantes UNVERIFIED con créditos por MONTO ÚNICO.
 * Con match → consume el crédito y CONFIRMA el pago en una transacción (recién aquí se libera);
 * sin match → el comprobante queda UNCONFIRMED (no se libera). La IA nunca confirma: solo el
 * crédito real lo hace (I6). Pensado para invocarse desde un endpoint o un cron por tenant.
 */
export class RunSettlementReconciliationService {
  private readonly logger = new Logger('Payments:SettlementReconciliation');

  constructor(
    private readonly source: SettlementSource,
    private readonly credits: IncomingCreditDrizzleRepository,
    private readonly reconciliation: PaymentReconciliationDrizzleRepository,
    private readonly sender: OutboundTextSender,
  ) {}

  async execute(cmd: {
    tenantId: string;
  }): Promise<SettlementReconciliationSummary> {
    const account = await this.credits.findSettlementAccount(cmd.tenantId);
    if (!account) {
      return { processed: 0, confirmed: 0, unconfirmed: 0 };
    }

    // 1) Poblar el ground truth: traer e ingerir los créditos de la ventana (idempotente).
    await this.ingestFresh(cmd.tenantId, account);

    // 2) Cargar comprobantes pendientes y créditos disponibles.
    const claims = await this.loadPendingClaims(cmd.tenantId);
    const available = await this.credits.listUnconsumed({
      tenantId: cmd.tenantId,
      bankAccountId: account.bankAccountId,
    });

    // 3) Emparejar por monto único (dominio puro).
    const claimRefs: ReceiptClaimRef[] = claims.map((c) => ({
      id: c.id,
      amountMinor: c.amountMinor,
    }));
    const result = matchCreditsToClaims(claimRefs, available);
    const byId = new Map(claims.map((c) => [c.id, c]));

    // 4) Confirmar cada match (consume crédito + abona, atómico).
    let confirmed = 0;
    for (const match of result.matches) {
      const claim = byId.get(match.claimId);
      if (!claim) continue;
      if (await this.confirmMatch(cmd.tenantId, claim, match.sourceId)) {
        confirmed++;
      }
    }

    return {
      processed: claims.length,
      confirmed,
      unconfirmed: claims.length - confirmed,
    };
  }

  private async ingestFresh(
    tenantId: string,
    account: {
      bankAccountId: string;
      countryCode: string;
      bankCode: string;
      windowDays: number | null;
    },
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
  ): Promise<boolean> {
    // Sin crédito activo asociado no hay cartera que abonar: se deja para revisión manual.
    const portfolio = claim.creditId
      ? await this.reconciliation.loadPortfolio({
          tenantId,
          creditId: claim.creditId,
        })
      : null;
    if (!portfolio) return false;

    const allocation = allocatePayment(
      portfolio.currency,
      portfolio.installments,
      Money.of(claim.amountMinor, portfolio.currency),
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
