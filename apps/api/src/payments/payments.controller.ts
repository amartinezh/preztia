import {
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { z } from 'zod';
import { ReconcilePendingPaymentsHandler } from '@preztiaos/application';
import { paginationQuery } from '@preztiaos/contracts';
import { PaymentsQueryRepository } from './payments-query.repository';

const uuid = z.string().uuid();

/**
 * Frontera HTTP del slice de pagos: valida con zod (contrato) y delega.
 * No contiene reglas de negocio ni SQL.
 */
@Controller()
export class PaymentsController {
  constructor(
    private readonly queries: PaymentsQueryRepository,
    private readonly reconcile: ReconcilePendingPaymentsHandler,
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

function requireTenant(tenantId: string | undefined): string {
  const parsed = uuid.safeParse(tenantId);
  if (!parsed.success)
    throw new UnauthorizedException('Falta la identidad del tenant');
  return parsed.data;
}
