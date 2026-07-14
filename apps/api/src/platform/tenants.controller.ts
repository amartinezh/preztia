import { createHash, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
  PurgeTenantDataHandler,
  UpdateTenantAdminHandler,
  UpdateTenantHandler,
} from '@preztiaos/application';
import {
  createTenantAdminInput,
  createTenantInput,
  paginationQuery,
  purgeTenantDataInput,
  updateTenantAdminInput,
  updateTenantInput,
} from '@preztiaos/contracts';
import { SuperAdminGuard } from './super-admin.guard';
import { TenantDrizzleRepository } from './tenants.repository';
import { TenantsQueryRepository } from './tenants-query.repository';
import { TenantAdminsQueryRepository } from './tenant-admins-query.repository';
import { PlatformUserRepository } from './platform-user.repository';
import { TenantDataPurgeRepository } from './tenant-data-purge.repository';
import { MinioTenantFilePurger } from './tenant-file-purge.storage';
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
  private readonly updateAdminHandler: UpdateTenantAdminHandler;
  private readonly purgeHandler: PurgeTenantDataHandler;

  constructor(
    private readonly tenants: TenantDrizzleRepository,
    private readonly queries: TenantsQueryRepository,
    private readonly adminQueries: TenantAdminsQueryRepository,
    private readonly users: PlatformUserRepository,
    private readonly hasher: ScryptPasswordHasher,
    private readonly dataPurger: TenantDataPurgeRepository,
    private readonly filePurger: MinioTenantFilePurger,
  ) {
    this.createHandler = new CreateTenantHandler(this.tenants);
    this.updateHandler = new UpdateTenantHandler(this.tenants);
    this.deleteHandler = new DeleteTenantHandler(this.tenants);
    this.createAdminHandler = new CreateTenantAdminHandler(
      this.tenants,
      this.users,
      this.hasher,
    );
    this.updateAdminHandler = new UpdateTenantAdminHandler(
      this.tenants,
      this.users,
      this.hasher,
    );
    this.purgeHandler = new PurgeTenantDataHandler(
      this.tenants,
      this.dataPurger,
      this.filePurger,
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

  @Get('admin/tenants/:id/admins')
  async listAdmins(
    @Param('id') id: string,
    @Query() query: Record<string, string>,
  ) {
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.adminQueries.listTenantAdmins({
      tenantId: uuid.parse(id),
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Patch('admin/tenants/:id/admins/:adminId')
  async updateAdmin(
    @Param('id') id: string,
    @Param('adminId') adminId: string,
    @Body() body: unknown,
  ) {
    const dto = updateTenantAdminInput.parse(body);
    return this.updateAdminHandler.execute({
      tenantId: uuid.parse(id),
      adminId: uuid.parse(adminId),
      ...dto,
    });
  }

  /**
   * Purga los datos de PRUEBA del tenant (reinicio): borra lo transaccional (BD + archivos)
   * y conserva usuarios y configuración. Doble portón: rol SUPER_ADMIN (guard) + contraseña
   * de confirmación "quemada" por entorno, para que un token robado no baste. La verificación
   * del secreto es una autorización de FRONTERA (no una regla de negocio) → vive aquí.
   */
  @Post('admin/tenants/:id/purge')
  @HttpCode(200)
  async purge(@Param('id') id: string, @Body() body: unknown) {
    const dto = purgeTenantDataInput.parse(body);
    assertPurgePassword(dto.confirmationPassword);
    return this.purgeHandler.execute(uuid.parse(id));
  }
}

/**
 * Verifica la contraseña de confirmación contra `PLATFORM_PURGE_PASSWORD` (secreto por
 * entorno). Comparación en tiempo constante sobre el digest SHA-256 (evita fugas por
 * longitud y por timing). Falla CERRADO: si el secreto no está configurado, la purga se
 * rechaza (403), nunca se ejecuta "sin candado".
 */
function assertPurgePassword(provided: string): void {
  const expected = process.env.PLATFORM_PURGE_PASSWORD;
  if (!expected) {
    throw new ForbiddenException(
      'La purga no está habilitada: falta configurar PLATFORM_PURGE_PASSWORD',
    );
  }
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  if (!timingSafeEqual(a, b)) {
    throw new ForbiddenException('Contraseña de purga incorrecta');
  }
}
