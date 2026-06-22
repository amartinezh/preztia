import { Controller, Get, Headers, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { DashboardQueryRepository } from './dashboard-query.repository';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';

// Panel de bienvenida del plano de datos: visible para cualquier operador autenticado del
// tenant. La identidad (tenant + rol) sale del JWT; RLS aísla los datos por tenant.
const DATA_PLANE_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;

/**
 * Frontera HTTP del DASHBOARD INICIAL: un único endpoint consolidado que devuelve todos los
 * KPIs del panel de bienvenida. Protegido por JWT; valida la frontera y delega en el read model.
 */
@Controller()
@UseGuards(JwtGuard)
export class DashboardController {
  constructor(private readonly queries: DashboardQueryRepository) {}

  @Get('dashboard/kpis')
  async kpis(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, DATA_PLANE_ROLES);
    return this.queries.getKpis({
      tenantId: tenant,
      currency: await resolveTenantCurrency(tenant),
    });
  }
}
