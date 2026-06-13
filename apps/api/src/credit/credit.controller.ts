import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { GrantCreditHandler } from '@preztiaos/application';
import { grantCreditInput, paginationQuery } from '@preztiaos/contracts';
import { CreditDrizzleRepository } from './credit.repository';
import { CreditQueryRepository } from './credit-query.repository';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';

/**
 * Frontera HTTP del slice de crédito: valida con zod (contrato) y delega.
 * Protegido por JWT (el tenant del header debe coincidir con el de la sesión).
 */
@Controller()
@UseGuards(JwtGuard)
export class CreditController {
  private readonly handler = new GrantCreditHandler(
    new CreditDrizzleRepository(),
  );
  private readonly queries = new CreditQueryRepository();

  @Get('credits')
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.queries.listCredits({
      tenantId: tenant,
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Post('credits')
  async grant(@Body() body: unknown, @Headers('x-tenant-id') tenantId: string) {
    const dto = grantCreditInput.parse(body); // validación con zod en la frontera
    // La moneda la fija el servidor por despliegue (Brasil → BRL), no el cliente.
    return this.handler.execute({
      ...dto,
      tenantId,
      currency: process.env.CREDIT_CURRENCY ?? 'COP',
    });
  }
}
