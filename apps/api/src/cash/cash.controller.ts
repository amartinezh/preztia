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
  RequestExpenseHandler,
  ReviewExpenseHandler,
} from '@preztiaos/application';
import {
  createExpenseInput,
  listExpensesQuery,
  reviewExpenseInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { Idempotent } from '../observability/idempotent.decorator';
import { ExpenseDrizzleRepository } from './expense.repository';
import { CashQueryRepository } from './cash-query.repository';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';

const uuid = z.string().uuid();

const DATA_PLANE_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;
// Revisar gastos es del socio/coordinador (maker-checker).
const MANAGER_ROLES = ['ADMIN', 'COORDINATOR'] as const;

/**
 * Frontera HTTP de CAJA: gastos (maker-checker) y reporte diario (P&L de cartera). El dinero real
 * (saldos, movimientos) vive en el libro de cajas (CashBoxController). Protegido por JWT; el rol
 * fino lo exige cada endpoint.
 */
@Controller()
@UseGuards(JwtGuard)
export class CashController {
  private readonly requestExpense: RequestExpenseHandler;
  private readonly reviewExpenseHandler: ReviewExpenseHandler;

  constructor(
    private readonly expenses: ExpenseDrizzleRepository,
    private readonly queries: CashQueryRepository,
  ) {
    this.requestExpense = new RequestExpenseHandler(this.expenses);
    this.reviewExpenseHandler = new ReviewExpenseHandler(this.expenses);
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
      ...(dto.paidFromCashBoxId
        ? { paidFromCashBoxId: dto.paidFromCashBoxId }
        : {}),
    });
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
      currency: await resolveTenantCurrency(tenant),
    });
  }
}
