import { Injectable, NotFoundException } from '@nestjs/common';
import { count, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  ConflictError,
  buildSettlement,
  businessDateOf,
  currentOpenPeriod,
  isPeriodEnded,
  isRetroactive,
  localHourInstant,
  nextPeriodToClose,
  scopeSettlement,
  type BusinessPeriod,
  type SettlementSettings,
  type SettlementSnapshot,
} from '@preztiaos/domain';
import type {
  CurrentSettlementOutput,
  SettlementSnapshot as SettlementSnapshotView,
  SettlementSummary,
  SettlementView,
} from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { resolveTenantTimeZone } from '../tenant-config/tenant-timezone';
import {
  readFirstActivity,
  readSettlementInputs,
  readSettlementSettings,
  type SettlementRange,
} from './settlement-inputs.reader';

type PeriodRow = typeof schema.settlementPeriod.$inferSelect;

// Tope de períodos pendientes que se cuentan (evita un bucle sin fin con una configuración rara).
const MAX_PENDING_SCAN = 520;
const MIDNIGHT = 0;
const AUDIT_ENTITY = 'settlement-period';

/**
 * LIQUIDACIÓN POR PERÍODOS. El período abierto se arma en vivo desde el libro; cerrar sella la
 * foto del SIGUIENTE período terminado (encadenado al último cerrado, sin huecos ni solapes). La
 * foto se guarda completa y se recorta al alcance de quien la mira (`scopes`: null = ADMIN).
 */
@Injectable()
export class SettlementRepository {
  async current(input: {
    tenantId: string;
    currency: string;
    scopes: readonly string[] | null;
    now: Date;
  }): Promise<CurrentSettlementOutput> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const ctx = await this.context(tx, input.tenantId, input.now);
      const period = currentOpenPeriod(ctx.settings, {
        lastClosedEnd: ctx.lastClosedEnd,
        today: ctx.today,
      });
      const range = toRange(period, ctx.timeZone);
      const snapshot = buildSettlement(await readSettlementInputs(tx, range));
      return {
        id: null,
        ...rangeFields(range, ctx.settings, input.currency),
        isOpen: true,
        retroactive: false,
        closedAt: null,
        closedBy: null,
        snapshot: toView(scopeSettlement(snapshot, input.scopes)),
        pendingClosures: pendingClosures(ctx),
      };
    });
  }

  /**
   * Cierra el siguiente período terminado. Serializado por tenant (candado transaccional) para que
   * el cron y el ADMIN no cierren a la vez; el índice único por inicio es la última guarda (I10).
   */
  async close(input: {
    tenantId: string;
    currency: string;
    closedBy: string | null;
    now: Date;
  }): Promise<string> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`settlement:${input.tenantId}`}))`,
      );
      const ctx = await this.context(tx, input.tenantId, input.now);
      const period = nextPeriodToClose(ctx.settings, {
        lastClosedEnd: ctx.lastClosedEnd,
        firstActivityDate: ctx.firstActivityDate,
      });
      if (!period)
        throw new ConflictError(
          'No hay movimientos que liquidar todavía',
          'NOTHING_TO_SETTLE',
        );
      if (!isPeriodEnded(period, ctx.today)) {
        throw new ConflictError(
          `El período ${period.start} → ${period.end} aún no termina`,
          'PERIOD_NOT_ENDED',
        );
      }
      const range = toRange(period, ctx.timeZone);
      const snapshot: SettlementSnapshot = buildSettlement(
        await readSettlementInputs(tx, range),
      );
      const [row] = await tx
        .insert(schema.settlementPeriod)
        .values({
          tenantId: input.tenantId,
          periodStart: period.start,
          periodEnd: period.end,
          startsAt: range.startsAt,
          endsAt: range.endsAt,
          frequency: ctx.settings.frequency,
          retroactive: isRetroactive(period, ctx.today),
          closedBy: input.closedBy,
          currency: input.currency,
          snapshot,
        })
        .returning({ id: schema.settlementPeriod.id });
      await tx.insert(schema.auditLog).values({
        tenantId: input.tenantId,
        actorId: input.closedBy,
        action: 'CLOSE settlement-period',
        entity: AUDIT_ENTITY,
        entityId: row.id,
        payload: {
          periodStart: period.start,
          periodEnd: period.end,
          closingMinor: snapshot.totals.closingMinor,
          utilityMinor: snapshot.result.utilityMinor,
        },
      });
      return row.id;
    });
  }

  /** Histórico (más recientes primero) con totales y resultado recortados al alcance. */
  async list(input: {
    tenantId: string;
    scopes: readonly string[] | null;
    page: number;
    pageSize: number;
  }): Promise<{ items: SettlementSummary[]; total: number }> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.settlementPeriod)
        .orderBy(desc(schema.settlementPeriod.periodStart))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [total] = await tx
        .select({ value: count() })
        .from(schema.settlementPeriod);
      return {
        items: rows.map((r) => {
          const snapshot = scopeSettlement(
            r.snapshot as SettlementSnapshot,
            input.scopes,
          );
          return {
            ...closedFields(r),
            totals: snapshot.totals,
            result: snapshot.result,
          };
        }),
        total: Number(total?.value ?? 0),
      };
    });
  }

  async get(input: {
    tenantId: string;
    id: string;
    scopes: readonly string[] | null;
  }): Promise<SettlementView> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.settlementPeriod)
        .where(eq(schema.settlementPeriod.id, input.id))
        .limit(1);
      if (!row) throw new NotFoundException('Liquidación no encontrada');
      return {
        ...closedFields(row),
        isOpen: false,
        snapshot: toView(
          scopeSettlement(row.snapshot as SettlementSnapshot, input.scopes),
        ),
      };
    });
  }

  /** Configuración, día de hoy y estado de los cierres del tenant. */
  private async context(
    tx: Tx,
    tenantId: string,
    now: Date,
  ): Promise<LiquidationContext> {
    const timeZone = await resolveTenantTimeZone(tx, tenantId);
    const [last] = await tx
      .select({ end: schema.settlementPeriod.periodEnd })
      .from(schema.settlementPeriod)
      .orderBy(desc(schema.settlementPeriod.periodEnd))
      .limit(1);
    const firstActivity = await readFirstActivity(tx);
    return {
      settings: await readSettlementSettings(tx, tenantId),
      timeZone,
      today: businessDateOf(now, timeZone),
      lastClosedEnd: last?.end ?? null,
      firstActivityDate: firstActivity
        ? businessDateOf(firstActivity, timeZone)
        : null,
    };
  }
}

interface LiquidationContext {
  settings: SettlementSettings;
  timeZone: string;
  today: string;
  lastClosedEnd: string | null;
  firstActivityDate: string | null;
}

/** La foto del dominio (listas de solo lectura) a la forma del contrato. */
function toView(s: SettlementSnapshot): SettlementSnapshotView {
  return {
    ...s,
    boxes: [...s.boxes],
    zones: [...s.zones],
    collectors: [...s.collectors],
  };
}

/** Cortes a medianoche local del tenant. */
function toRange(period: BusinessPeriod, timeZone: string): SettlementRange {
  return {
    periodStart: period.start,
    periodEnd: period.end,
    startsAt: localHourInstant(period.start, MIDNIGHT, timeZone),
    endsAt: localHourInstant(period.end, MIDNIGHT, timeZone),
  };
}

function rangeFields(
  range: SettlementRange,
  settings: SettlementSettings,
  currency: string,
) {
  return {
    periodStart: range.periodStart,
    periodEnd: range.periodEnd,
    startsAt: range.startsAt.toISOString(),
    endsAt: range.endsAt.toISOString(),
    frequency: settings.frequency,
    currency,
  };
}

function closedFields(r: PeriodRow) {
  return {
    id: r.id,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    frequency: r.frequency as SettlementSettings['frequency'],
    currency: r.currency,
    retroactive: r.retroactive,
    closedAt: r.closedAt.toISOString(),
    closedBy: r.closedBy,
  };
}

/** Cuántos períodos terminados faltan por cerrar (se avisa en la liquidación en curso). */
function pendingClosures(ctx: LiquidationContext): number {
  let lastClosedEnd = ctx.lastClosedEnd;
  let pending = 0;
  for (let i = 0; i < MAX_PENDING_SCAN; i++) {
    const next = nextPeriodToClose(ctx.settings, {
      lastClosedEnd,
      firstActivityDate: ctx.firstActivityDate,
    });
    if (!next || !isPeriodEnded(next, ctx.today)) break;
    pending += 1;
    lastClosedEnd = next.end;
  }
  return pending;
}
