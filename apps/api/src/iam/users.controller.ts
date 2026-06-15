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
  CreateUserHandler,
  DeactivateUserHandler,
  UpdateUserHandler,
} from '@preztiaos/application';
import {
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

// Roles que pueden administrar usuarios: ADMIN (todo el tenant) y COORDINATOR (crea
// cobradores en su alcance). La jerarquía fina la valida el caso de uso.
const USER_MANAGER_ROLES = ['ADMIN', 'COORDINATOR'] as const;
// Editar/desactivar usuarios arbitrarios es exclusivo del ADMIN (evita que un coordinador
// modifique a otros usuarios); el coordinador solo CREA cobradores y les asigna clientes.
const ADMIN_ONLY = ['ADMIN'] as const;

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

  constructor(
    private readonly users: UserDrizzleRepository,
    private readonly queries: UsersQueryRepository,
    private readonly hasher: ScryptPasswordHasher,
  ) {
    this.createHandler = new CreateUserHandler(this.users, this.hasher);
    this.updateHandler = new UpdateUserHandler(this.users);
    this.deactivateHandler = new DeactivateUserHandler(this.users);
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
    const session = requireRole(authorization, ADMIN_ONLY);
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
