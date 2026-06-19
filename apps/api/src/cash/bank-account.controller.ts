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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { bankAccountInput, bankAccountPatch } from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireAdmin } from '../auth/require-admin';
import { Idempotent } from '../observability/idempotent.decorator';
import { BankAccountDrizzleRepository } from './bank-account.repository';

const uuid = z.string().uuid();

/**
 * Frontera HTTP del CRUD de cuentas bancarias. Restringido al ADMIN del tenant: gestiona
 * la configuración financiera (llaves PIX y credenciales de API). Protegido por JWT.
 */
@Controller()
@UseGuards(JwtGuard)
export class BankAccountController {
  constructor(private readonly accounts: BankAccountDrizzleRepository) {}

  @Get('bank-accounts')
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireAdmin(auth);
    return { items: await this.accounts.list(tenant) };
  }

  @Post('bank-accounts')
  @HttpCode(201)
  @Idempotent()
  async create(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireAdmin(auth);
    return this.accounts.create(tenant, bankAccountInput.parse(body));
  }

  @Patch('bank-accounts/:id')
  async update(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireAdmin(auth);
    return this.accounts.update(
      tenant,
      uuid.parse(id),
      bankAccountPatch.parse(body),
    );
  }

  @Delete('bank-accounts/:id')
  async remove(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireAdmin(auth);
    return this.accounts.remove(tenant, uuid.parse(id));
  }
}
