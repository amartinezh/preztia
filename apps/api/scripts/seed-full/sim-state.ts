import { addDays } from '@preztiaos/domain';
import type { TenantContext } from './context';
import { RouteBook, type ExpenseRecord } from './field-ops';
import type { BorrowerState, UserRef } from './model';
import type { IncomingCredit, Receipt } from './pix';
import type { CollectorSpec } from './scenario';
import type { ClosedPeriod } from './settlements';

// Estado de la SIMULACIÓN de un tenant que no vive en las filas: cola de renovaciones, gastos por
// revisar, pagos PIX en revisión, último nivel de mora visitado, períodos cerrados, cobradores
// retirados y libros de rendición por caja de ruta.

export interface PendingReview {
  readonly expense: ExpenseRecord;
  readonly collector: CollectorSpec;
  readonly approve: boolean;
}

export interface PicpayReview {
  readonly receipt: Receipt;
  readonly reserved: IncomingCredit;
  readonly amountMinor: number;
}

export class SimulationState {
  readonly books = new Map<string, RouteBook>();
  /** Cobrador VIGENTE de cada cliente (cambia cuando un cobrador se retira). */
  readonly collectorOf = new Map<string, UserRef>();
  readonly renewals = new Map<string, BorrowerState[]>();
  readonly pendingReviews: PendingReview[] = [];
  readonly lastVisit = new Map<string, number>();
  /** Monto PIX reportado y aún sin abonar, por crédito (el cliente no lo vuelve a pagar). */
  readonly pendingPix = new Map<string, number>();
  readonly picpayToVerify: PicpayReview[] = [];
  readonly closed: ClosedPeriod[] = [];
  readonly retired = new Set<string>();
  /** Créditos con parada de ruta en el día: no reciben el cobro regular (lo liquida la parada). */
  readonly routedToday = new Set<string>();
  readonly receipts: Receipt[] = [];
  /** Consignaciones emitidas por cobrador (para variar su desenlace). */
  readonly depositsIssued = new Map<string, number>();
  lastClosedEnd: string | null = null;

  constructor(
    readonly ctx: TenantContext,
    readonly start: string,
    readonly days: readonly string[],
  ) {
    for (const spec of ctx.scenario.collectors) {
      const user = ctx.user(spec.userKey);
      this.books.set(
        user.id,
        new RouteBook(ctx.ledger, ctx.box(spec.routeBoxKey), user),
      );
    }
  }

  /** Índice de semana (0 = la del inicio) de una fecha simulada. */
  weekOf(date: string): number {
    return Math.floor(this.days.indexOf(date) / 7);
  }

  /** Día en que se retira un cobrador (viernes de su última semana); null si no se retira. */
  retirementDate(spec: CollectorSpec): string | null {
    return spec.retiresAfterWeek
      ? addDays(this.start, spec.retiresAfterWeek * 7 - 3)
      : null;
  }

  isActive(spec: CollectorSpec): boolean {
    return !this.retired.has(spec.userKey);
  }

  book(collector: UserRef): RouteBook {
    const book = this.books.get(collector.id);
    if (!book)
      throw new Error(`Sin libro de rendición para ${collector.email}`);
    return book;
  }

  addPendingPix(creditId: string, amountMinor: number): void {
    this.pendingPix.set(
      creditId,
      (this.pendingPix.get(creditId) ?? 0) + amountMinor,
    );
  }

  clearPendingPix(creditId: string, amountMinor: number): void {
    this.pendingPix.set(
      creditId,
      Math.max(0, (this.pendingPix.get(creditId) ?? 0) - amountMinor),
    );
  }
}
