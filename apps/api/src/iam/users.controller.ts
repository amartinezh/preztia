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
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  ChangeOwnPasswordHandler,
  CreateUserHandler,
  DeactivateUserHandler,
  UpdateUserHandler,
} from '@preztiaos/application';
import {
  changeMyPasswordInput,
  createUserInput,
  updateUserInput,
  userRole as userRoleSchema,
  paginationQuery,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole, type Session } from '../auth/require-role';
import { UserDrizzleRepository } from './users.repository';
import { UsersQueryRepository } from './users-query.repository';
import { ScryptPasswordHasher } from '../auth/password-hasher';

const uuid = z.string().uuid();

// Roles que pueden administrar usuarios: ADMIN (todo el tenant) y COORDINATOR (sus cobradores:
// los crea, les restablece la contraseña y les edita nombre/zonas/estado). Que el COORDINATOR
// solo alcance a cobradores de su subárbol lo impone el caso de uso (defensa en profundidad).
const USER_MANAGER_ROLES = ['ADMIN', 'COORDINATOR'] as const;
// Desactivar usuarios arbitrarios es exclusivo del ADMIN.
const ADMIN_ONLY = ['ADMIN'] as const;
// Cualquier rol del tenant cambia su PROPIA contraseña (el SUPER_ADMIN no tiene tenant).
const TENANT_ROLES = ['ADMIN', 'COORDINATOR', 'COLLECTOR'] as const;

/**
 * Frontera HTTP del CRUD de usuarios del tenant. Protegido por JWT (tenant del header =
 * sesión) y rol de gestión. Valida con zod y delega; la jerarquía/alcance los impone el caso
 * de uso (`ForbiddenError` → 403 vía filtro global).
 */
@Controller()
@UseGuards(JwtGuard)
export class UsersController {
  private readonly createHandler: CreateUserHandler;
  private readonly updateHandler: UpdateUserHandler;
  private readonly deactivateHandler: DeactivateUserHandler;
  private readonly changeOwnPasswordHandler: ChangeOwnPasswordHandler;

  constructor(
    private readonly users: UserDrizzleRepository,
    private readonly queries: UsersQueryRepository,
    private readonly hasher: ScryptPasswordHasher,
  ) {
    this.createHandler = new CreateUserHandler(this.users, this.hasher);
    this.updateHandler = new UpdateUserHandler(this.users, this.hasher);
    this.deactivateHandler = new DeactivateUserHandler(this.users);
    this.changeOwnPasswordHandler = new ChangeOwnPasswordHandler(
      this.users,
      this.hasher,
    );
  }

  /**
   * Cambio de la PROPIA contraseña (exige la actual). La contraseña nunca se registra: el
   * `AuditInterceptor` enmascara todo campo cuyo nombre contenga "password" antes de auditar.
   */
  @Post('me/password')
  @HttpCode(204)
  async changeMyPassword(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<void> {
    requireTenant(tenantId);
    const session = requireRole(authorization, TENANT_ROLES);
    const dto = changeMyPasswordInput.parse(body);
    await this.changeOwnPasswordHandler.execute({
      actor: actorFrom(session),
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
    });
  }

  @Get('users')
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, USER_MANAGER_ROLES);
    const { page, pageSize } = paginationQuery.parse(query);
    const role = query.role ? userRoleSchema.parse(query.role) : undefined;
    const { items, total } = await this.queries.listUsers({
      tenantId: tenant,
      page,
      pageSize,
      ...(role ? { role } : {}),
    });
    return { items, page, pageSize, total };
  }

  @Post('users')
  @HttpCode(201)
  async create(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    requireTenant(tenantId);
    const session = requireRole(authorization, USER_MANAGER_ROLES);
    const dto = createUserInput.parse(body);
    return this.createHandler.execute({ actor: actorFrom(session), ...dto });
  }

  @Patch('users/:id')
  async update(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    requireTenant(tenantId);
    const session = requireRole(authorization, USER_MANAGER_ROLES);
    const dto = updateUserInput.parse(body);
    return this.updateHandler.execute({
      actor: actorFrom(session),
      userId: uuid.parse(id),
      ...dto,
    });
  }

  @Delete('users/:id')
  @HttpCode(204)
  async deactivate(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    await this.deactivateHandler.execute({
      tenantId: tenant,
      userId: uuid.parse(id),
    });
  }
}

/** Construye el contexto del actor (para el caso de uso) a partir de la sesión del JWT. */
function actorFrom(session: Session) {
  return {
    userId: session.userId,
    role: session.role,
    tenantId: session.tenantId,
    zonePaths: session.zonePaths,
  };
}
