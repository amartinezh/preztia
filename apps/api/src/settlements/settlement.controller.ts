import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { paginationQuery } from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireReviewer } from '../auth/require-reviewer';
import { requireAdmin } from '../auth/require-admin';
import type { Session } from '../auth/require-role';
import { Idempotent } from '../observability/idempotent.decorator';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';
import { SettlementRepository } from './settlement.repository';

const uuid = z.string().uuid();

/** Alcance de la liquidación: el ADMIN ve todo; el coordinador, su subárbol de zonas. */
function scopesOf(session: Session): readonly string[] | null {
  return session.role === 'ADMIN' ? null : session.zonePaths;
}

/**
 * Frontera HTTP de la LIQUIDACIÓN POR PERÍODOS. Lectura para ADMIN/COORDINATOR (recortada al
 * alcance); cerrar es del ADMIN. El cobrador no ve liquidaciones (403 por `requireReviewer`).
 */
@Controller()
@UseGuards(JwtGuard)
export class SettlementController {
  constructor(private readonly settlements: SettlementRepository) {}

  @Get('settlements/current')
  async current(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    return this.settlements.current({
      tenantId: tenant,
      currency: await resolveTenantCurrency(tenant),
      scopes: scopesOf(reviewer),
      now: new Date(),
    });
  }

  @Get('settlements')
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.settlements.list({
      tenantId: tenant,
      scopes: scopesOf(reviewer),
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Get('settlements/:id')
  async get(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    return this.settlements.get({
      tenantId: tenant,
      id: uuid.parse(id),
      scopes: scopesOf(reviewer),
    });
  }

  // Cierra el siguiente período terminado; repetirlo reconstruye la historia (retroactivos).
  @Post('settlements/close')
  @HttpCode(201)
  @Idempotent()
  async close(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const admin = requireAdmin(auth);
    const id = await this.settlements.close({
      tenantId: tenant,
      currency: await resolveTenantCurrency(tenant),
      closedBy: admin.userId,
      now: new Date(),
    });
    return this.settlements.get({ tenantId: tenant, id, scopes: null });
  }
}
