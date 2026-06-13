import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ReconcilePendingPaymentsHandler } from '@preztiaos/application';
import {
  paginationQuery,
  registerCashPaymentInput,
} from '@preztiaos/contracts';
import { PaymentsQueryRepository } from './payments-query.repository';
import { CashPaymentDrizzleRepository } from './cash-payment.repository';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';

const uuid = z.string().uuid();

/**
 * Frontera HTTP del slice de pagos: valida con zod (contrato) y delega.
 * No contiene reglas de negocio ni SQL. Protegido por JWT.
 */
@Controller()
@UseGuards(JwtGuard)
export class PaymentsController {
  constructor(
    private readonly queries: PaymentsQueryRepository,
    private readonly reconcile: ReconcilePendingPaymentsHandler,
    private readonly cashPayments: CashPaymentDrizzleRepository,
  ) {}

  @Get('credits/:creditId/payments')
  async listPayments(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const id = uuid.parse(creditId);
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.queries.listCreditPayments({
      tenantId: tenant,
      creditId: id,
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Post('credits/:creditId/payments')
  async registerCashPayment(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const id = uuid.parse(creditId);
    const { amountMinor } = registerCashPaymentInput.parse(body);
    const result = await this.cashPayments.register({
      tenantId: tenant,
      creditId: id,
      amountMinor,
      idempotencyKey: idempotencyKey ?? null,
    });
    if (!result) throw new NotFoundException('Crédito no encontrado');
    return result;
  }

  @Get('credits/:creditId/portfolio')
  async getPortfolio(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const id = uuid.parse(creditId);
    const portfolio = await this.queries.getPortfolio({
      tenantId: tenant,
      creditId: id,
    });
    if (!portfolio) throw new NotFoundException('Crédito no encontrado');
    return portfolio;
  }

  @Post('payments/reconcile')
  @HttpCode(200)
  async reconcilePayments(
    @Headers('x-tenant-id') tenantId: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    return this.reconcile.execute({ tenantId: tenant });
  }
}
