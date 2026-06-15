import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { GrantCreditHandler } from '@preztiaos/application';
import {
  grantCreditInput,
  listAccountsQuery,
  paginationQuery,
} from '@preztiaos/contracts';
import { CreditDrizzleRepository } from './credit.repository';
import { CreditQueryRepository } from './credit-query.repository';
import { AccountsQueryRepository } from './accounts-query.repository';
import { BorrowerPolicyRepository } from './borrower-policy.repository';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { Idempotent } from '../observability/idempotent.decorator';

const uuid = z.string().uuid();

// Consultar créditos/cuentas lo puede hacer cualquier rol del plano de datos.
const DATA_PLANE_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;

/**
 * Frontera HTTP del slice de crédito: valida con zod (contrato) y delega.
 * Protegido por JWT (el tenant del header debe coincidir con el de la sesión).
 */
@Controller()
@UseGuards(JwtGuard)
export class CreditController {
  // El otorgamiento respeta el cupo/bloqueo del cliente (puerto de política sobre `borrower`).
  private readonly handler = new GrantCreditHandler(
    new CreditDrizzleRepository(),
    new BorrowerPolicyRepository(),
  );
  private readonly queries = new CreditQueryRepository();
  private readonly accounts = new AccountsQueryRepository();

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
  @Idempotent()
  async grant(@Body() body: unknown, @Headers('x-tenant-id') tenantId: string) {
    const dto = grantCreditInput.parse(body); // validación con zod en la frontera
    // La moneda la fija el servidor por despliegue (Brasil → BRL), no el cliente.
    return this.handler.execute({
      ...dto,
      tenantId,
      currency: process.env.CREDIT_CURRENCY ?? 'COP',
    });
  }

  @Get('accounts')
  async listAccounts(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, DATA_PLANE_ROLES);
    const { page, pageSize, name, nationalId, onlyOverdue } =
      listAccountsQuery.parse(query);
    const { items, total } = await this.accounts.listAccounts({
      tenantId: tenant,
      page,
      pageSize,
      ...(name ? { name } : {}),
      ...(nationalId ? { nationalId } : {}),
      ...(onlyOverdue ? { onlyOverdue } : {}),
    });
    return { items, page, pageSize, total };
  }

  @Get('accounts/:creditId')
  async accountDetail(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, DATA_PLANE_ROLES);
    const detail = await this.accounts.getAccountDetail({
      tenantId: tenant,
      creditId: uuid.parse(creditId),
    });
    if (!detail) throw new NotFoundException('Cuenta no encontrada');
    return detail;
  }
}
