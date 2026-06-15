import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AssignCoordinatorHandler,
  CreateZoneHandler,
  DeleteZoneHandler,
  UpdateZoneHandler,
} from '@preztiaos/application';
import {
  assignCoordinatorInput,
  createZoneInput,
  updateZoneInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole, type Session } from '../auth/require-role';
import { ZoneDrizzleRepository } from './zones.repository';
import { ZonesQueryRepository } from './zones-query.repository';
import { UserDrizzleRepository } from './users.repository';

const uuid = z.string().uuid();

// La gestión de zonas es del ADMIN del tenant.
const ADMIN_ONLY = ['ADMIN'] as const;

/**
 * Frontera HTTP del CRUD del árbol de zonas (ADMIN). Valida con zod y delega; el dominio
 * construye los paths ltree y el filtro global traduce `DomainError` a 404/409.
 */
@Controller()
@UseGuards(JwtGuard)
export class ZonesController {
  private readonly createHandler: CreateZoneHandler;
  private readonly updateHandler: UpdateZoneHandler;
  private readonly deleteHandler: DeleteZoneHandler;
  private readonly assignHandler: AssignCoordinatorHandler;

  constructor(
    private readonly zones: ZoneDrizzleRepository,
    private readonly queries: ZonesQueryRepository,
    private readonly users: UserDrizzleRepository,
  ) {
    this.createHandler = new CreateZoneHandler(this.zones);
    this.updateHandler = new UpdateZoneHandler(this.zones);
    this.deleteHandler = new DeleteZoneHandler(this.zones);
    this.assignHandler = new AssignCoordinatorHandler(this.zones, this.users);
  }

  @Get('zones')
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const items = await this.queries.listZones({ tenantId: tenant });
    return { items };
  }

  @Post('zones')
  @HttpCode(201)
  async create(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    requireTenant(tenantId);
    const session = requireRole(authorization, ADMIN_ONLY);
    const dto = createZoneInput.parse(body);
    return this.createHandler.execute({
      actor: actorFrom(session),
      name: dto.name,
      parentZoneId: dto.parentZoneId,
    });
  }

  @Patch('zones/:id')
  async update(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    requireTenant(tenantId);
    const session = requireRole(authorization, ADMIN_ONLY);
    const dto = updateZoneInput.parse(body);
    return this.updateHandler.execute({
      actor: actorFrom(session),
      zoneId: uuid.parse(id),
      name: dto.name,
    });
  }

  @Delete('zones/:id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    await this.deleteHandler.execute({
      tenantId: tenant,
      zoneId: uuid.parse(id),
    });
  }

  @Post('zones/:id/coordinators')
  @HttpCode(204)
  async assignCoordinator(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<void> {
    requireTenant(tenantId);
    const session = requireRole(authorization, ADMIN_ONLY);
    const dto = assignCoordinatorInput.parse(body);
    await this.assignHandler.execute({
      actor: actorFrom(session),
      zoneId: uuid.parse(id),
      coordinatorId: dto.coordinatorId,
    });
  }
}

function actorFrom(session: Session) {
  return {
    userId: session.userId,
    role: session.role,
    tenantId: session.tenantId,
    zonePaths: session.zonePaths,
  };
}
