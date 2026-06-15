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
  AddBorrowerNoteHandler,
  CreateBorrowerHandler,
  UpdateBorrowerHandler,
} from '@preztiaos/application';
import {
  addBorrowerNoteInput,
  createBorrowerInput,
  listBorrowersQuery,
  paginationQuery,
  updateBorrowerInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import {
  BorrowerDrizzleRepository,
  BorrowerNoteDrizzleRepository,
} from './borrowers.repository';
import { BorrowersQueryRepository } from './borrowers-query.repository';
import { TenantConfigRepository } from '../tenant-config/tenant-config.repository';

const uuid = z.string().uuid();

// Cualquier rol del plano de datos puede consultar clientes; gestionarlos (alta/edición) es de
// ADMIN/COORDINATOR. El cobrador puede anotar (registrar notas de cobro) los clientes a su cargo.
const DATA_PLANE_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;
const MANAGER_ROLES = ['ADMIN', 'COORDINATOR'] as const;

/**
 * Frontera HTTP del registro de CLIENTES (deudores). Protegido por JWT (tenant del header =
 * sesión) y rol. Valida con zod y delega; las reglas/invariantes los impone el caso de uso.
 */
@Controller()
@UseGuards(JwtGuard)
export class BorrowersController {
  private readonly createHandler: CreateBorrowerHandler;
  private readonly updateHandler: UpdateBorrowerHandler;
  private readonly addNoteHandler: AddBorrowerNoteHandler;

  constructor(
    private readonly borrowers: BorrowerDrizzleRepository,
    private readonly notes: BorrowerNoteDrizzleRepository,
    private readonly queries: BorrowersQueryRepository,
    private readonly config: TenantConfigRepository,
  ) {
    // El alta aplica el cupo por defecto del tenant cuando se crea sin cupo (config).
    this.createHandler = new CreateBorrowerHandler(this.borrowers, this.config);
    this.updateHandler = new UpdateBorrowerHandler(this.borrowers);
    this.addNoteHandler = new AddBorrowerNoteHandler(
      this.notes,
      this.borrowers,
    );
  }

  @Get('borrowers')
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, DATA_PLANE_ROLES);
    const { page, pageSize, nationalId, name, withoutCredits } =
      listBorrowersQuery.parse(query);
    const { items, total } = await this.queries.listBorrowers({
      tenantId: tenant,
      page,
      pageSize,
      ...(nationalId ? { nationalId } : {}),
      ...(name ? { name } : {}),
      ...(withoutCredits ? { withoutCredits } : {}),
    });
    return { items, page, pageSize, total };
  }

  @Post('borrowers')
  @HttpCode(201)
  async create(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    const dto = createBorrowerInput.parse(body);
    return this.createHandler.execute({ tenantId: tenant, ...dto });
  }

  @Patch('borrowers/:id')
  async update(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    const patch = updateBorrowerInput.parse(body);
    return this.updateHandler.execute({
      tenantId: tenant,
      borrowerId: uuid.parse(id),
      patch,
    });
  }

  @Get('borrowers/:id/notes')
  async listNotes(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, DATA_PLANE_ROLES);
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.queries.listNotes({
      tenantId: tenant,
      borrowerId: uuid.parse(id),
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Post('borrowers/:id/notes')
  @HttpCode(201)
  async addNote(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const session = requireRole(authorization, DATA_PLANE_ROLES);
    const dto = addBorrowerNoteInput.parse(body);
    return this.addNoteHandler.execute({
      tenantId: tenant,
      borrowerId: uuid.parse(id),
      authorId: session.userId,
      body: dto.body,
    });
  }
}
