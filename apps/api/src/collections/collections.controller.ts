import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AddCollectionObservationHandler,
  MarkCollectionVisitedHandler,
  SendCollectionReminderHandler,
} from '@preztiaos/application';
import {
  addCollectionObservationInput,
  criticalRouteInput,
  listVisitTargetsQuery,
  type CriticalRouteOutput,
  type MarkCollectionVisitedOutput,
  type SendReminderOutput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireReviewer } from '../auth/require-reviewer';
import { requireRole } from '../auth/require-role';
import { DueCreditsRepository } from './due-credits.repository';
import { CriticalClientsRepository } from './critical-clients.repository';
import { PortfolioMapRepository } from './portfolio-map.repository';
import { OsrmRouteOptimizer } from './osrm-route-optimizer';
import { VisitTargetsRepository } from './visit-targets.repository';
import { CollectionLogRepository } from './collection-log.repository';

const uuid = z.string().uuid();

// El cobrador opera la ruta de visitas; el revisor (coordinador/ADMIN) además consulta la bitácora
// desde el historial del cliente.
const COLLECTOR_ROLES = ['COLLECTOR'] as const;
const LOG_READER_ROLES = ['COLLECTOR', 'COORDINATOR', 'ADMIN'] as const;

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
    private readonly visitTargets: VisitTargetsRepository,
    private readonly collectionLog: CollectionLogRepository,
    private readonly addObservation: AddCollectionObservationHandler,
    private readonly markVisited: MarkCollectionVisitedHandler,
  ) {}

  @Get('collections/critical-clients')
  async listCriticalClients(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    return this.criticalClients.list(reviewer);
  }

  @Get('collections/portfolio-map')
  async listPortfolioMap(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    return this.portfolioMap.list(reviewer);
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

    const { items: clients } = await this.criticalClients.list(reviewer);
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

  // ── Visitas de cobro en campo (perfil del COBRADOR) ──────────────────────────────────────

  @Get('collections/visits')
  async listVisits(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, COLLECTOR_ROLES);
    const { status } = listVisitTargetsQuery.parse(query);
    return this.visitTargets.list({
      tenantId: tenant,
      collectorId: session.userId,
      status,
    });
  }

  @Get('credits/:creditId/collection-log')
  async collectionLogFor(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, LOG_READER_ROLES);
    const id = uuid.parse(creditId);
    // El cobrador solo puede leer la bitácora de los créditos de su cartera asignada.
    if (session.role === 'COLLECTOR') {
      const snapshot = await this.visitTargets.findForCollector({
        tenantId: tenant,
        collectorId: session.userId,
        creditId: id,
      });
      if (!snapshot) throw new NotFoundException('Crédito no encontrado');
    }
    const items = await this.collectionLog.list({
      tenantId: tenant,
      creditId: id,
    });
    return { items };
  }

  @Post('credits/:creditId/collection-notes')
  @HttpCode(201)
  async addObservationFor(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, COLLECTOR_ROLES);
    const dto = addCollectionObservationInput.parse(body);
    return this.addObservation.execute({
      tenantId: tenant,
      collectorId: session.userId,
      creditId: uuid.parse(creditId),
      body: dto.body,
    });
  }

  @Post('credits/:creditId/collection-visit')
  @HttpCode(200)
  async markVisitedFor(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<MarkCollectionVisitedOutput> {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, COLLECTOR_ROLES);
    const threshold = await this.visitTargets.resolveThreshold(tenant);
    return this.markVisited.execute({
      tenantId: tenant,
      collectorId: session.userId,
      creditId: uuid.parse(creditId),
      threshold,
    });
  }
}
