import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { ReportingQueryRepository } from './reporting-query.repository';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';

const uuid = z.string().uuid();
const DATA_PLANE_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;
const MANAGER_ROLES = ['ADMIN', 'COORDINATOR'] as const;

/** Frontera HTTP de REPORTERÍA: panel, resumen de cliente y export CSV. Protegido por JWT. */
@Controller()
@UseGuards(JwtGuard)
export class ReportingController {
  constructor(private readonly queries: ReportingQueryRepository) {}

  @Get('reports/dashboard')
  async dashboard(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    return this.queries.getDashboard({
      tenantId: tenant,
      currency: await resolveTenantCurrency(tenant),
    });
  }

  @Get('borrowers/:id/summary')
  async borrowerSummary(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, DATA_PLANE_ROLES);
    const report = await this.queries.getBorrowerReport({
      tenantId: tenant,
      borrowerId: uuid.parse(id),
    });
    if (!report) throw new NotFoundException('El cliente no existe');
    return report;
  }

  @Get('reports/accounts-export')
  async exportAccounts(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    const csv = await this.queries.exportAccountsCsv({ tenantId: tenant });
    return {
      filename: `cuentas-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
    };
  }
}
