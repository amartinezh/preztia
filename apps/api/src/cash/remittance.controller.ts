import {
  Body,
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
import {
  closeDebtInput,
  paginationQuery,
  receiveRemittanceInput,
  remittanceBoardQuery,
  remittanceHistoryQuery,
  submitRemittanceInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireAdmin } from '../auth/require-admin';
import { requireReviewer } from '../auth/require-reviewer';
import { requireRole } from '../auth/require-role';
import { zoneScopePredicate } from '../iam/zone-scope';
import { Idempotent } from '../observability/idempotent.decorator';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';
import { RemittanceDrizzleRepository } from './remittance.repository';
import { RemittanceQueryRepository } from './remittance-query.repository';

const uuid = z.string().uuid();
// Solo el cobrador tiene caja de ruta (la asignación exige rol COLLECTOR).
const COLLECTOR_ROLES = ['COLLECTOR'] as const;

/**
 * Frontera HTTP de la RENDICIÓN del cobrador. El cobrador declara y ve SU caja (`/me/*`); el
 * coordinador ve y recibe dentro de su subárbol de zonas; solo el ADMIN cierra deuda. Valida con
 * zod y delega; los `DomainError` los traduce el filtro global.
 */
@Controller()
@UseGuards(JwtGuard)
export class RemittanceController {
  constructor(
    private readonly remittances: RemittanceDrizzleRepository,
    private readonly queries: RemittanceQueryRepository,
  ) {}

  @Get('me/remittance')
  async mine(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, COLLECTOR_ROLES);
    return this.queries.mine({
      tenantId: tenant,
      collectorId: session.userId,
      currency: await resolveTenantCurrency(tenant),
      now: new Date(),
    });
  }

  @Post('me/remittances')
  @HttpCode(201)
  @Idempotent()
  async submit(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, COLLECTOR_ROLES);
    return this.remittances.submit({
      tenantId: tenant,
      collectorId: session.userId,
      currency: await resolveTenantCurrency(tenant),
      body: submitRemittanceInput.parse(body),
      now: new Date(),
    });
  }

  @Get('me/remittances')
  async myHistory(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, COLLECTOR_ROLES);
    const { page, pageSize } = paginationQuery.parse(query);
    // Su propio historial completo: el alcance es él mismo, no la zona.
    const { items, total } = await this.queries.history({
      tenantId: tenant,
      zoneScope: undefined,
      collectorId: session.userId,
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Get('remittances/board')
  async board(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    const { page, pageSize, withDebt } = remittanceBoardQuery.parse(query);
    const { items, total } = await this.queries.board({
      tenantId: tenant,
      currency: await resolveTenantCurrency(tenant),
      zoneScope: zoneScopePredicate(reviewer),
      withDebt,
      page,
      pageSize,
      now: new Date(),
    });
    return { items, page, pageSize, total };
  }

  @Get('remittances')
  async history(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    const { page, pageSize, collectorId } = remittanceHistoryQuery.parse(query);
    const { items, total } = await this.queries.history({
      tenantId: tenant,
      zoneScope: zoneScopePredicate(reviewer),
      collectorId,
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Post('remittances/:id/receive')
  @HttpCode(200)
  @Idempotent()
  async receive(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    return this.remittances.receive({
      tenantId: tenant,
      remittanceId: uuid.parse(id),
      receivedBy: reviewer.userId,
      zoneScope: zoneScopePredicate(reviewer),
      body: receiveRemittanceInput.parse(body),
    });
  }

  // Cerrar deuda (nómina o condonación) cambia la utilidad: solo el ADMIN.
  @Post('collectors/:id/debt-closures')
  @HttpCode(201)
  @Idempotent()
  async closeDebt(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const admin = requireAdmin(auth);
    const input = closeDebtInput.parse(body);
    return this.remittances.closeDebt({
      tenantId: tenant,
      collectorId: uuid.parse(id),
      currency: await resolveTenantCurrency(tenant),
      closedBy: admin.userId,
      ...input,
      now: new Date(),
    });
  }
}
