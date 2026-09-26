import { Controller, Get, Headers, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { DashboardQueryRepository } from './dashboard-query.repository';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';

// Panel de bienvenida con cifras de TODA la empresa (tesorería, cartera, solicitudes, fraude):
// solo ADMIN/COORDINATOR. El cobrador tiene su propio inicio (su caja, su rendición, su ruta) y no
// debe dimensionar las cifras del negocio. La identidad (tenant + rol) sale del JWT.
const MANAGER_ROLES = ['ADMIN', 'COORDINATOR'] as const;

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
    requireRole(authorization, MANAGER_ROLES);
    return this.queries.getKpis({
      tenantId: tenant,
      currency: await resolveTenantCurrency(tenant),
    });
  }
}
