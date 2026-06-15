import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  RequestBorrowerChangeHandler,
  ReviewBorrowerChangeHandler,
} from '@preztiaos/application';
import {
  createChangeRequestInput,
  listChangeRequestsQuery,
  reviewChangeRequestInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { BorrowerDrizzleRepository } from '../borrowers/borrowers.repository';
import { ChangeRequestDrizzleRepository } from './change-request.repository';
import { OperationsQueryRepository } from './operations-query.repository';

const uuid = z.string().uuid();
const DATA_PLANE_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;
// Revisar solicitudes y ver la lista de cobros es del socio/coordinador.
const MANAGER_ROLES = ['ADMIN', 'COORDINATOR'] as const;

/**
 * Frontera HTTP de OPERACIONES: solicitudes de modificación de cliente (maker-checker) y lista
 * de cobros/rutas. Protegido por JWT; el rol fino lo exige cada endpoint.
 */
@Controller()
@UseGuards(JwtGuard)
export class OperationsController {
  private readonly requestChange: RequestBorrowerChangeHandler;
  private readonly reviewChangeHandler: ReviewBorrowerChangeHandler;

  constructor(
    private readonly requests: ChangeRequestDrizzleRepository,
    private readonly borrowers: BorrowerDrizzleRepository,
    private readonly queries: OperationsQueryRepository,
  ) {
    this.requestChange = new RequestBorrowerChangeHandler(
      this.requests,
      this.borrowers,
    );
    this.reviewChangeHandler = new ReviewBorrowerChangeHandler(
      this.requests,
      this.borrowers,
    );
  }

  @Get('change-requests')
  async listChangeRequests(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    const { page, pageSize, status } = listChangeRequestsQuery.parse(query);
    const { items, total } = await this.queries.listChangeRequests({
      tenantId: tenant,
      page,
      pageSize,
      ...(status ? { status } : {}),
    });
    return { items, page, pageSize, total };
  }

  @Post('change-requests')
  @HttpCode(201)
  async createChangeRequest(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, DATA_PLANE_ROLES);
    const dto = createChangeRequestInput.parse(body);
    return this.requestChange.execute({
      tenantId: tenant,
      borrowerId: dto.borrowerId,
      requestedBy: session.userId,
      changes: dto.changes,
    });
  }

  @Patch('change-requests/:id')
  async reviewChangeRequest(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, MANAGER_ROLES);
    const dto = reviewChangeRequestInput.parse(body);
    return this.reviewChangeHandler.execute({
      tenantId: tenant,
      requestId: uuid.parse(id),
      reviewerId: session.userId,
      approve: dto.approve,
    });
  }

  @Get('routes')
  async listRoutes(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    return { items: await this.queries.listRoutes(tenant) };
  }
}
