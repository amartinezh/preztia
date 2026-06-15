import {
  Body,
  Controller,
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
  CloseSettlementHandler,
  PreviewSettlementHandler,
  RequestExpenseHandler,
  ReviewExpenseHandler,
} from '@preztiaos/application';
import {
  createExpenseInput,
  listExpensesQuery,
  paginationQuery,
  reviewExpenseInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { Idempotent } from '../observability/idempotent.decorator';
import { ExpenseDrizzleRepository } from './expense.repository';
import { SettlementDrizzleRepository } from './settlement.repository';
import { CashQueryRepository } from './cash-query.repository';

const uuid = z.string().uuid();

const DATA_PLANE_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;
// Revisar gastos y cerrar liquidadas es del socio/coordinador (maker-checker).
const MANAGER_ROLES = ['ADMIN', 'COORDINATOR'] as const;

function currency(): string {
  return process.env.CREDIT_CURRENCY ?? 'COP';
}

/**
 * Frontera HTTP de CAJA: gastos (maker-checker), liquidadas (cierre encadenado) y reporte
 * diario. Protegido por JWT; el rol fino lo exige cada endpoint.
 */
@Controller()
@UseGuards(JwtGuard)
export class CashController {
  private readonly requestExpense: RequestExpenseHandler;
  private readonly reviewExpenseHandler: ReviewExpenseHandler;
  private readonly previewHandler: PreviewSettlementHandler;
  private readonly closeHandler: CloseSettlementHandler;

  constructor(
    private readonly expenses: ExpenseDrizzleRepository,
    private readonly settlements: SettlementDrizzleRepository,
    private readonly queries: CashQueryRepository,
  ) {
    this.requestExpense = new RequestExpenseHandler(this.expenses);
    this.reviewExpenseHandler = new ReviewExpenseHandler(this.expenses);
    this.previewHandler = new PreviewSettlementHandler(this.settlements);
    this.closeHandler = new CloseSettlementHandler(this.settlements);
  }

  // --- Gastos ---------------------------------------------------------------

  @Get('expenses')
  async listExpenses(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, DATA_PLANE_ROLES);
    const { page, pageSize, status } = listExpensesQuery.parse(query);
    const { items, total } = await this.queries.listExpenses({
      tenantId: tenant,
      page,
      pageSize,
      ...(status ? { status } : {}),
    });
    return { items, page, pageSize, total };
  }

  @Post('expenses')
  @HttpCode(201)
  @Idempotent()
  async createExpense(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, DATA_PLANE_ROLES);
    const dto = createExpenseInput.parse(body);
    return this.requestExpense.execute({
      tenantId: tenant,
      requestedBy: session.userId,
      description: dto.description,
      amountMinor: dto.amountMinor,
    });
  }

  @Patch('expenses/:id')
  async reviewExpense(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, MANAGER_ROLES);
    const dto = reviewExpenseInput.parse(body);
    return this.reviewExpenseHandler.execute({
      tenantId: tenant,
      expenseId: uuid.parse(id),
      reviewerId: session.userId,
      approve: dto.approve,
    });
  }

  // --- Liquidadas -----------------------------------------------------------

  @Get('settlements/preview')
  async previewSettlement(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    const p = await this.previewHandler.execute({ tenantId: tenant });
    return {
      cajaAnteriorMinor: p.cajaAnteriorMinor,
      totalCobradoMinor: p.totalCobradoMinor,
      totalPrestadoMinor: p.totalPrestadoMinor,
      gastosMinor: p.gastosMinor,
      cajaActualMinor: p.cajaActualMinor,
      cuentasNuevas: p.cuentasNuevas,
      cuentasTerminadas: p.cuentasTerminadas,
      periodStart: p.periodStart.toISOString(),
      currency: currency(),
    };
  }

  @Post('settlements')
  @HttpCode(201)
  @Idempotent()
  async closeSettlement(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, MANAGER_ROLES);
    const s = await this.closeHandler.execute({
      tenantId: tenant,
      closedBy: session.userId,
    });
    return {
      id: s.id,
      periodStart: s.periodStart.toISOString(),
      periodEnd: s.periodEnd.toISOString(),
      cajaAnteriorMinor: s.cajaAnteriorMinor,
      totalCobradoMinor: s.totalCobradoMinor,
      totalPrestadoMinor: s.totalPrestadoMinor,
      gastosMinor: s.gastosMinor,
      cajaActualMinor: s.cajaActualMinor,
      cuentasNuevas: s.cuentasNuevas,
      cuentasTerminadas: s.cuentasTerminadas,
      createdAt: s.periodEnd.toISOString(),
    };
  }

  @Get('settlements')
  async listSettlements(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, DATA_PLANE_ROLES);
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.queries.listSettlements({
      tenantId: tenant,
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  // --- Reporte diario -------------------------------------------------------

  @Get('reports/daily')
  async dailyReport(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, DATA_PLANE_ROLES);
    const date =
      z.string().date().optional().parse(query.date) ??
      new Date().toISOString().slice(0, 10);
    return this.queries.getDailyReport({
      tenantId: tenant,
      date,
      currency: currency(),
    });
  }
}
