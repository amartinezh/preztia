import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  adjustCashBalanceInput,
  cashCountInput,
  createCashBoxInput,
  listCashTransactionsQuery,
  registerCashMovementInput,
  registerWithdrawalInput,
  transferInput,
  updateCashBoxInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireAdmin } from '../auth/require-admin';
import { requireRole } from '../auth/require-role';
import { Idempotent } from '../observability/idempotent.decorator';
import { CashBoxDrizzleRepository } from './cash-box.repository';
import { CashQueryRepository } from './cash-query.repository';
import { CashCountDrizzleRepository } from './cash-count.repository';
import { BankReconciliationDrizzleRepository } from './bank-reconciliation.repository';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';

const uuid = z.string().uuid();

// Reportería/lectura: todo el plano de datos. Mover dinero: socio/coordinador.
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
    requireRole(auth, DATA_PLANE_ROLES);
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
    requireRole(auth, DATA_PLANE_ROLES);
    const {
      page,
      pageSize,
      cashBoxId,
      kind,
      direction,
      userId,
      collectorId,
      borrowerId,
      from,
      to,
    } = listCashTransactionsQuery.parse(query);
    const { items, total } = await this.queries.listCashTransactions({
      tenantId: tenant,
      page,
      pageSize,
      ...(cashBoxId ? { cashBoxId } : {}),
      ...(kind ? { kind } : {}),
      ...(direction ? { direction } : {}),
      ...(userId ? { userId } : {}),
      ...(collectorId ? { collectorId } : {}),
      ...(borrowerId ? { borrowerId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    return { items, page, pageSize, total };
  }

  @Get('cash/dashboard')
  async dashboard(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(auth, DATA_PLANE_ROLES);
    return this.queries.getCashDashboard({
      tenantId: tenant,
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
