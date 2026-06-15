import {
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UpdateTenantSettingsHandler } from '@preztiaos/application';
import { updateOperationalSettingsInput } from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { TenantConfigRepository } from './tenant-config.repository';

// La configuración de cobro la administra el ADMIN del tenant.
const ADMIN_ONLY = ['ADMIN'] as const;

/** Frontera HTTP de la CONFIGURACIÓN DE COBRO (ajustes operativos del tenant). */
@Controller()
@UseGuards(JwtGuard)
export class TenantConfigController {
  private readonly updateHandler: UpdateTenantSettingsHandler;

  constructor(private readonly config: TenantConfigRepository) {
    this.updateHandler = new UpdateTenantSettingsHandler(this.config);
  }

  @Get('tenant-config/operational-settings')
  async get(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    return this.config.get(tenant);
  }

  @Patch('tenant-config/operational-settings')
  async update(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const patch = updateOperationalSettingsInput.parse(body);
    return this.updateHandler.execute({ tenantId: tenant, patch });
  }
}
