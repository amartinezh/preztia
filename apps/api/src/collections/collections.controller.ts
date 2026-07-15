import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SendCollectionReminderHandler } from '@preztiaos/application';
import {
  criticalRouteInput,
  type CriticalRouteOutput,
  type SendReminderOutput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireReviewer } from '../auth/require-reviewer';
import { DueCreditsRepository } from './due-credits.repository';
import { CriticalClientsRepository } from './critical-clients.repository';
import { PortfolioMapRepository } from './portfolio-map.repository';
import { OsrmRouteOptimizer } from './osrm-route-optimizer';

const uuid = z.string().uuid();

/**
 * Frontera HTTP de COBRANZA (vista de Cartera/Gestión de Créditos). El coordinador/ADMIN consulta
 * el panel de cobro de un crédito y dispara el recordatorio de WhatsApp de forma manual e
 * inmediata. La validación de entrada es del contrato; las reglas y el envío, del caso de uso.
 * El abono y el transcript ya quedan cubiertos por el sender (registra el saliente) y el handler
 * (auditoría + idempotencia). Protegida por JWT.
 */
@Controller()
@UseGuards(JwtGuard)
export class CollectionsController {
  constructor(
    private readonly dueCredits: DueCreditsRepository,
    private readonly sendReminder: SendCollectionReminderHandler,
    private readonly criticalClients: CriticalClientsRepository,
    private readonly portfolioMap: PortfolioMapRepository,
    private readonly routeOptimizer: OsrmRouteOptimizer,
  ) {}

  @Get('collections/critical-clients')
  async listCriticalClients(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    const items = await this.criticalClients.list(reviewer);
    return { threshold: this.criticalClients.threshold(), items };
  }

  @Get('collections/portfolio-map')
  async listPortfolioMap(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    const items = await this.portfolioMap.list(reviewer);
    return { threshold: this.portfolioMap.threshold(), items };
  }

  @Post('collections/critical-route')
  @HttpCode(200)
  async criticalRoute(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<CriticalRouteOutput> {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    const { start } = criticalRouteInput.parse(body);

    const clients = await this.criticalClients.list(reviewer);
    const route = await this.routeOptimizer.optimize({
      start,
      stops: clients.map((c) => ({
        latitude: c.latitude,
        longitude: c.longitude,
      })),
    });
    // Reordena los clientes según la secuencia óptima y los numera 1..N.
    const stops = route.order.map((clientIndex, position) => ({
      ...clients[clientIndex],
      order: position + 1,
    }));
    return {
      stops,
      geometry: route.geometry,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      degraded: route.degraded,
    };
  }

  @Get('credits/:creditId/collection')
  async getCollection(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireReviewer(authorization);
    const panel = await this.dueCredits.getPanel({
      tenantId: tenant,
      creditId: uuid.parse(creditId),
    });
    if (!panel) throw new NotFoundException('Crédito no encontrado');
    return panel;
  }

  @Post('credits/:creditId/collection-reminder')
  @HttpCode(200)
  async send(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<SendReminderOutput> {
    const tenant = requireTenant(tenantId);
    const session = requireReviewer(authorization);
    const result = await this.sendReminder.sendForCredit({
      tenantId: tenant,
      creditId: uuid.parse(creditId),
      actorId: session.userId,
    });
    return {
      sent: result.sent,
      reason: result.reason ?? null,
      phone: result.phone ?? null,
      dueMinor: result.dueMinor ?? null,
      currency: result.currency ?? null,
      messagePreview: result.messagePreview ?? null,
    };
  }
}
