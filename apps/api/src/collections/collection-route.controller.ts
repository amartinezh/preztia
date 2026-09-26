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
  cancelStopInput,
  dispatchRouteInput,
  myRouteStopsQuery,
  paginationQuery,
  resolveStopInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireReviewer } from '../auth/require-reviewer';
import { requireRole } from '../auth/require-role';
import { zoneScopePredicate } from '../iam/zone-scope';
import { Idempotent } from '../observability/idempotent.decorator';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';
import { CollectionRouteDrizzleRepository } from './collection-route.repository';
import { CollectionRouteQueryRepository } from './collection-route-query.repository';

const uuid = z.string().uuid();
const COLLECTOR_ROLES = ['COLLECTOR'] as const;

/**
 * Frontera HTTP de las ÓRDENES DE RUTA. El coordinador propone, despacha, sigue y cancela dentro
 * de su subárbol de zonas; el cobrador ve SUS paradas (vista mínima mientras están abiertas) y las
 * liquida. Valida con zod y delega; los `DomainError` los traduce el filtro global.
 */
@Controller()
@UseGuards(JwtGuard)
export class CollectionRouteController {
  constructor(
    private readonly routes: CollectionRouteDrizzleRepository,
    private readonly queries: CollectionRouteQueryRepository,
  ) {}

  @Get('collection-routes/proposal')
  async proposal(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Query('zoneId') zoneId: string,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    return this.queries.proposal({
      tenantId: tenant,
      zoneId: uuid.parse(zoneId),
      zoneScope: zoneScopePredicate(reviewer),
    });
  }

  @Post('collection-routes')
  @HttpCode(201)
  @Idempotent()
  async dispatch(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    const currency = await resolveTenantCurrency(tenant);
    const routeId = await this.routes.dispatch({
      tenantId: tenant,
      createdBy: reviewer.userId,
      zoneScope: zoneScopePredicate(reviewer),
      currency,
      body: dispatchRouteInput.parse(body),
    });
    return this.queries.getRoute({
      tenantId: tenant,
      routeId,
      zoneScope: zoneScopePredicate(reviewer),
      currency,
    });
  }

  @Get('collection-routes')
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.queries.listRoutes({
      tenantId: tenant,
      zoneScope: zoneScopePredicate(reviewer),
      currency: await resolveTenantCurrency(tenant),
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Get('collection-routes/:id')
  async detail(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    return this.queries.getRoute({
      tenantId: tenant,
      routeId: uuid.parse(id),
      zoneScope: zoneScopePredicate(reviewer),
      currency: await resolveTenantCurrency(tenant),
    });
  }

  @Post('route-stops/:id/cancel')
  @HttpCode(200)
  async cancel(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const reviewer = requireReviewer(auth);
    const stopId = uuid.parse(id);
    await this.routes.cancel({
      tenantId: tenant,
      cancelledBy: reviewer.userId,
      stopId,
      zoneScope: zoneScopePredicate(reviewer),
      reason: cancelStopInput.parse(body).reason,
    });
    return this.queries.getReviewerStop({ tenantId: tenant, stopId });
  }

  @Get('me/route-stops')
  async myStops(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, COLLECTOR_ROLES);
    const { page, pageSize, status } = myRouteStopsQuery.parse(query);
    const { items, total } = await this.queries.myStops({
      tenantId: tenant,
      collectorId: session.userId,
      status,
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Post('me/route-stops/:id/seen')
  @HttpCode(200)
  async seen(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, COLLECTOR_ROLES);
    const stopId = uuid.parse(id);
    await this.routes.markSeen({
      tenantId: tenant,
      collectorId: session.userId,
      stopId,
    });
    return this.queries.myStop({
      tenantId: tenant,
      collectorId: session.userId,
      stopId,
    });
  }

  // Liquidar mueve dinero cuando la visita terminó en pago: idempotente por Idempotency-Key.
  @Post('me/route-stops/:id/resolve')
  @HttpCode(200)
  @Idempotent()
  async resolve(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(auth, COLLECTOR_ROLES);
    const stopId = uuid.parse(id);
    await this.routes.resolve({
      tenantId: tenant,
      collectorId: session.userId,
      stopId,
      body: resolveStopInput.parse(body),
    });
    return this.queries.myStop({
      tenantId: tenant,
      collectorId: session.userId,
      stopId,
    });
  }
}
