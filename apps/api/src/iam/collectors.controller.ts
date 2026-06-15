import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AssignCollectorClientsHandler } from '@preztiaos/application';
import { assignClientsInput, paginationQuery } from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole, type Session } from '../auth/require-role';
import { CollectorClientRepository } from './collector-client.repository';
import { ClientsQueryRepository } from './clients-query.repository';
import { UserDrizzleRepository } from './users.repository';
import { zoneScopePredicate } from './zone-scope';

const uuid = z.string().uuid();

// Asignar clientes es del coordinador (y del admin). El cobrador consulta su propia cartera.
const CLIENT_ASSIGNER_ROLES = ['ADMIN', 'COORDINATOR'] as const;
const COLLECTOR_ROLES = ['COLLECTOR'] as const;

/**
 * Frontera HTTP de la asignación cobrador → clientes. El coordinador lista los clientes de su
 * alcance y reemplaza la cartera de un cobrador; el cobrador lee solo sus clientes asignados.
 */
@Controller()
@UseGuards(JwtGuard)
export class CollectorsController {
  private readonly assignHandler: AssignCollectorClientsHandler;

  constructor(
    private readonly assignments: CollectorClientRepository,
    private readonly clients: ClientsQueryRepository,
    private readonly users: UserDrizzleRepository,
  ) {
    this.assignHandler = new AssignCollectorClientsHandler(
      this.assignments,
      this.users,
    );
  }

  @Get('collectors/:id/assignable-clients')
  async assignable(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, CLIENT_ASSIGNER_ROLES);
    const { page, pageSize } = paginationQuery.parse(query);
    const scope = zoneScopePredicate(session);
    const { items, total } = await this.clients.listAssignableClients({
      tenantId: tenant,
      collectorId: uuid.parse(id),
      page,
      pageSize,
      ...(scope ? { scope } : {}),
    });
    return { items, page, pageSize, total };
  }

  @Put('collectors/:id/clients')
  async assign(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    requireTenant(tenantId);
    const session = requireRole(authorization, CLIENT_ASSIGNER_ROLES);
    const dto = assignClientsInput.parse(body);
    return this.assignHandler.execute({
      actor: actorFrom(session),
      collectorId: uuid.parse(id),
      borrowerIds: dto.borrowerIds,
    });
  }

  @Get('me/clients')
  async myClients(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, COLLECTOR_ROLES);
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.clients.listMyClients({
      tenantId: tenant,
      collectorId: session.userId,
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
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
