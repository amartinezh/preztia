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
import { RecordCollectorLocationHandler } from '@preztiaos/application';
import { recordLocationInput } from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { LocationDrizzleRepository } from './location.repository';
import { TrackingQueryRepository } from './tracking-query.repository';

const uuid = z.string().uuid();
const DATA_PLANE_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;
// Ver recorridos/posiciones de otros es del socio/coordinador.
const MANAGER_ROLES = ['ADMIN', 'COORDINATOR'] as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Frontera HTTP de TRACKING: el cobrador registra su posición; el socio ve el recorrido, el
 * último registro y la posición de los clientes. Protegido por JWT.
 */
@Controller()
@UseGuards(JwtGuard)
export class TrackingController {
  private readonly recordHandler: RecordCollectorLocationHandler;

  constructor(
    private readonly locations: LocationDrizzleRepository,
    private readonly queries: TrackingQueryRepository,
  ) {
    this.recordHandler = new RecordCollectorLocationHandler(this.locations);
  }

  @Post('me/locations')
  @HttpCode(201)
  async record(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, DATA_PLANE_ROLES);
    const dto = recordLocationInput.parse(body);
    return this.recordHandler.execute({
      tenantId: tenant,
      collectorId: session.userId,
      lat: dto.lat,
      lng: dto.lng,
    });
  }

  @Get('collectors/:id/track')
  async track(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    const date = z.string().date().optional().parse(query.date) ?? today();
    return {
      items: await this.queries.getTrack({
        tenantId: tenant,
        collectorId: uuid.parse(id),
        date,
      }),
    };
  }

  @Get('collectors/:id/last-location')
  async lastLocation(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    return {
      point: await this.queries.getLastLocation({
        tenantId: tenant,
        collectorId: uuid.parse(id),
      }),
    };
  }

  @Get('clients/positions')
  async clientPositions(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    return {
      items: await this.queries.getClientPositions({ tenantId: tenant }),
    };
  }
}
