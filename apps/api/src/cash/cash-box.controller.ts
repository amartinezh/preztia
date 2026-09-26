import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { CashTransactionRow } from '@preztiaos/contracts';
import { toCsv } from '../shared/csv';
import {
  adjustCashBalanceInput,
  cashCountInput,
  createCashBoxInput,
  fundingBoxesQuery,
  listCashTransactionsQuery,
  registerCashMovementInput,
  registerWithdrawalInput,
  transferInput,
  updateCashBoxInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireAdmin } from '../auth/require-admin';
import { requireRole, type Session } from '../auth/require-role';
import { requireReviewer } from '../auth/require-reviewer';
import { zoneScopePredicate } from '../iam/zone-scope';
import { Idempotent } from '../observability/idempotent.decorator';
import { CashBoxDrizzleRepository } from './cash-box.repository';
import { CashQueryRepository } from './cash-query.repository';
import { CashCountDrizzleRepository } from './cash-count.repository';
import { BankReconciliationDrizzleRepository } from './bank-reconciliation.repository';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';

const uuid = z.string().uuid();

// Lecturas de tesorería y mover dinero: socio/coordinador. El plano de datos completo (incluido
// el cobrador) solo para lo propio (`/me/cash-box`).
const DATA_PLANE_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;
const MANAGER_ROLES = ['ADMIN', 'COORDINATOR'] as const;

/**
 * Frontera HTTP de CAJAS: CRUD (ADMIN), movimientos (retiro/egreso de caja menor y
 * transferencias, socio/coordinador) y vistas (dashboard + historial). Protegido por JWT.
 */
@Controller()
@UseGuards(JwtGuard)
export class CashBoxController {
  constructor(
    private readonly boxes: CashBoxDrizzleRepository,
    private readonly queries: CashQueryRepository,
    private readonly cashCounts: CashCountDrizzleRepository,
    private readonly reconciliations: BankReconciliationDrizzleRepository,
  ) {}

  // --- CRUD de cajas (ADMIN) -------------------------------------------------

  @Get('cash/boxes')
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    // Cajas y saldos son tesorería: solo ADMIN/COORDINATOR (el cobrador ve SU caja en /me/cash-box).
    requireRole(auth, MANAGER_ROLES);
    return { items: await this.boxes.list(tenant) };
  }

  @Post('cash/boxes')
  @HttpCode(201)
  @Idempotent()
  async create(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireAdmin(auth);
    return this.boxes.create(tenant, createCashBoxInput.parse(body));
  }

  @Patch('cash/boxes/:id')
  async update(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireAdmin(auth);
    return this.boxes.update(
      tenant,
      uuid.parse(id),
      updateCashBoxInput.parse(body),
    );
  }

  @Delete('cash/boxes/:id')
  async remove(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireAdmin(auth);
    return this.boxes.remove(tenant, uuid.parse(id));
  }

  // --- Movimientos (socio/coordinador) --------------------------------------

  @Post('cash/boxes/:id/withdrawals')
  @HttpCode(201)
  @Idempotent()
  async withdraw(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, MANAGER_ROLES);
    const dto = registerWithdrawalInput.parse(body);
    return this.boxes.post({
      tenantId: tenant,
      cashBoxId: uuid.parse(id),
      direction: 'OUT',
      kind: 'WITHDRAWAL',
      amountMinor: dto.amountMinor,
      reason: dto.reason,
      createdBy: session.userId,
    });
  }

  @Post('cash/boxes/:id/movements')
  @HttpCode(201)
  @Idempotent()
  async move(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, MANAGER_ROLES);
    const dto = registerCashMovementInput.parse(body);
    return this.boxes.post({
      tenantId: tenant,
      cashBoxId: uuid.parse(id),
      direction: dto.direction,
      kind: dto.direction === 'IN' ? 'PAYMENT_IN' : 'WITHDRAWAL',
      amountMinor: dto.amountMinor,
      reason: dto.reason,
      createdBy: session.userId,
    });
  }

  @Post('cash/transfers')
  @HttpCode(201)
  @Idempotent()
  async transfer(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, MANAGER_ROLES);
    const dto = transferInput.parse(body);
    return this.boxes.transfer({
      tenantId: tenant,
      fromBoxId: dto.fromBoxId,
      toBoxId: dto.toBoxId,
      amountMinor: dto.amountMinor,
      reason: dto.reason,
      createdBy: session.userId,
    });
  }

  // --- Vistas (plano de datos) ----------------------------------------------

  @Get('cash/transactions')
  async transactions(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    // El libro mayor es tesorería: el cobrador no lo ve; el coordinador, solo su subárbol.
    const session = requireRole(auth, MANAGER_ROLES);
    const { page, pageSize, ...filters } =
      listCashTransactionsQuery.parse(query);
    const { items, total } = await this.queries.listCashTransactions({
      tenantId: tenant,
      page,
      pageSize,
      ...definedFilters(filters),
      ...scopeOf(session),
    });
    return { items, page, pageSize, total };
  }

  // Exportación CSV del libro con los mismos filtros (detalle de una liquidación). Texto plano,
  // sin caché: lleva motivos escritos por usuarios (escapados contra inyección de fórmulas).
  @Get('cash/transactions/export')
  async exportTransactions(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, MANAGER_ROLES);
    // La exportación no pagina: mismos filtros sin page/pageSize.
    const filters = listCashTransactionsQuery
      .omit({ page: true, pageSize: true })
      .parse(query);
    const { items, truncated } = await this.queries.exportCashTransactions({
      tenantId: tenant,
      ...definedFilters(filters),
      ...scopeOf(session),
    });
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader(
        'Content-Disposition',
        'attachment; filename="movimientos.csv"',
      )
      .setHeader('Cache-Control', 'no-store')
      .setHeader('X-Export-Truncated', String(truncated))
      .send(ledgerCsv(items));
  }

  @Get('cash/dashboard')
  async dashboard(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    // Saldos de todas las cajas: solo ADMIN/COORDINATOR (el cobrador no dimensiona las cifras).
    requireRole(auth, MANAGER_ROLES);
    return this.queries.getCashDashboard({
      tenantId: tenant,
      currency: await resolveTenantCurrency(tenant),
    });
  }

  // Cajas de las que una zona puede desembolsar: quien otorga/aprueba (ADMIN/COORDINATOR),
  // acotado a su subárbol de zonas.
  @Get('cash/funding-boxes')
  async fundingBoxes(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    const { zoneId } = fundingBoxesQuery.parse(query);
    const items = await this.queries.listFundingBoxes({
      tenantId: tenant,
      zoneId,
      zoneScope: zoneScopePredicate(reviewer),
    });
    if (!items) throw new NotFoundException('Zona no encontrada');
    return { items };
  }

  // Caja de ruta propia (efectivo en poder del usuario): el móvil la consulta antes de cobrar
  // en efectivo, porque la cola offline descarta los rechazos de negocio.
  @Get('me/cash-box')
  async myCashBox(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, DATA_PLANE_ROLES);
    return this.queries.findMyCashBox({
      tenantId: tenant,
      userId: session.userId,
      currency: await resolveTenantCurrency(tenant),
    });
  }

  // --- Arqueo y conciliación (Req 7) ----------------------------------------

  @Post('cash/boxes/:id/count')
  @HttpCode(201)
  @Idempotent()
  async count(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, MANAGER_ROLES);
    const dto = cashCountInput.parse(body);
    return this.cashCounts.count({
      tenantId: tenant,
      cashBoxId: uuid.parse(id),
      countedMinor: dto.countedMinor,
      notes: dto.notes ?? null,
      performedBy: session.userId,
    });
  }

  @Post('cash/boxes/:id/adjust')
  @HttpCode(201)
  @Idempotent()
  async adjust(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, MANAGER_ROLES);
    const dto = adjustCashBalanceInput.parse(body);
    return this.boxes.adjustToCount({
      tenantId: tenant,
      cashBoxId: uuid.parse(id),
      cashCountId: dto.cashCountId,
      reason: dto.reason,
      createdBy: session.userId,
    });
  }

  @Post('cash/boxes/:id/sync')
  @HttpCode(200)
  async syncBank(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireAdmin(auth);
    return this.reconciliations.sync({
      tenantId: tenant,
      cashBoxId: uuid.parse(id),
      syncedBy: session.userId,
    });
  }
}

/** Solo los filtros presentes (el repositorio distingue "sin filtro" de un valor). */
function definedFilters<T extends Record<string, unknown>>(
  filters: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** El coordinador ve los asientos de su subárbol de zonas; el ADMIN, todo el libro. */
function scopeOf(session: Session): { zoneScope?: SQL } {
  const scope = zoneScopePredicate(session);
  return scope ? { zoneScope: scope } : {};
}

const LEDGER_CSV_HEADER = [
  'fecha',
  'caja',
  'zona',
  'tipo',
  'sentido',
  'monto_minor',
  'moneda',
  'motivo',
];

function ledgerCsv(items: CashTransactionRow[]): string {
  return toCsv(
    LEDGER_CSV_HEADER,
    items.map((t) => [
      t.createdAt,
      t.boxName,
      t.zoneName ?? '',
      t.kind,
      t.direction,
      String(t.amountMinor),
      t.currency,
      t.reason ?? '',
    ]),
  );
}
