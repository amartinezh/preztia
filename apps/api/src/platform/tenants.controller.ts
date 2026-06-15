import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  CreateTenantAdminHandler,
  CreateTenantHandler,
  DeleteTenantHandler,
  UpdateTenantHandler,
} from '@preztiaos/application';
import {
  createTenantAdminInput,
  createTenantInput,
  paginationQuery,
  updateTenantInput,
} from '@preztiaos/contracts';
import { SuperAdminGuard } from './super-admin.guard';
import { TenantDrizzleRepository } from './tenants.repository';
import { TenantsQueryRepository } from './tenants-query.repository';
import { PlatformUserRepository } from './platform-user.repository';
import { ScryptPasswordHasher } from '../auth/password-hasher';

const uuid = z.string().uuid();

/**
 * Frontera HTTP del PLANO DE CONTROL (super admin): CRUD de tenants y provisión de admins.
 * Protegido por `SuperAdminGuard` (rol SUPER_ADMIN); no usa `x-tenant-id`. Valida con zod
 * y delega; los `DomainError` los traduce el filtro global a 404/409.
 */
@Controller()
@UseGuards(SuperAdminGuard)
export class TenantsController {
  private readonly createHandler: CreateTenantHandler;
  private readonly updateHandler: UpdateTenantHandler;
  private readonly deleteHandler: DeleteTenantHandler;
  private readonly createAdminHandler: CreateTenantAdminHandler;

  constructor(
    private readonly tenants: TenantDrizzleRepository,
    private readonly queries: TenantsQueryRepository,
    private readonly users: PlatformUserRepository,
    private readonly hasher: ScryptPasswordHasher,
  ) {
    this.createHandler = new CreateTenantHandler(this.tenants);
    this.updateHandler = new UpdateTenantHandler(this.tenants);
    this.deleteHandler = new DeleteTenantHandler(this.tenants);
    this.createAdminHandler = new CreateTenantAdminHandler(
      this.tenants,
      this.users,
      this.hasher,
    );
  }

  @Get('admin/tenants')
  async list(@Query() query: Record<string, string>) {
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.queries.listTenants({ page, pageSize });
    return { items, page, pageSize, total };
  }

  @Post('admin/tenants')
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const dto = createTenantInput.parse(body);
    return this.createHandler.execute(dto);
  }

  @Patch('admin/tenants/:id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const dto = updateTenantInput.parse(body);
    return this.updateHandler.execute({ id: uuid.parse(id), ...dto });
  }

  @Delete('admin/tenants/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.deleteHandler.execute(uuid.parse(id));
  }

  @Post('admin/tenants/:id/admins')
  @HttpCode(201)
  async createAdmin(@Param('id') id: string, @Body() body: unknown) {
    const dto = createTenantAdminInput.parse(body);
    return this.createAdminHandler.execute({
      tenantId: uuid.parse(id),
      ...dto,
    });
  }
}
