import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AddListMembersHandler,
  CreateBorrowerListHandler,
  DeleteBorrowerListHandler,
  RemoveListMemberHandler,
} from '@preztiaos/application';
import {
  addListMembersInput,
  createBorrowerListInput,
  paginationQuery,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { BorrowerListDrizzleRepository } from './borrower-list.repository';
import { BorrowerListsQueryRepository } from './borrower-lists-query.repository';

const uuid = z.string().uuid();
const MANAGER_ROLES = ['ADMIN', 'COORDINATOR'] as const;

/**
 * Frontera HTTP de LISTAS PERSONALIZADAS (segmentación). Gestionarlas es de ADMIN/COORDINATOR.
 */
@Controller()
@UseGuards(JwtGuard)
export class BorrowerListsController {
  private readonly createHandler: CreateBorrowerListHandler;
  private readonly deleteHandler: DeleteBorrowerListHandler;
  private readonly addHandler: AddListMembersHandler;
  private readonly removeHandler: RemoveListMemberHandler;

  constructor(
    private readonly lists: BorrowerListDrizzleRepository,
    private readonly queries: BorrowerListsQueryRepository,
  ) {
    this.createHandler = new CreateBorrowerListHandler(this.lists);
    this.deleteHandler = new DeleteBorrowerListHandler(this.lists);
    this.addHandler = new AddListMembersHandler(this.lists);
    this.removeHandler = new RemoveListMemberHandler(this.lists);
  }

  @Get('borrower-lists')
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    return { items: await this.queries.listLists(tenant) };
  }

  @Post('borrower-lists')
  @HttpCode(201)
  async create(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    const dto = createBorrowerListInput.parse(body);
    return this.createHandler.execute({ tenantId: tenant, name: dto.name });
  }

  @Delete('borrower-lists/:id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    await this.deleteHandler.execute({
      tenantId: tenant,
      listId: uuid.parse(id),
    });
  }

  @Get('borrower-lists/:id/members')
  async members(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.queries.listMembers({
      tenantId: tenant,
      listId: uuid.parse(id),
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Post('borrower-lists/:id/members')
  async addMembers(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    const dto = addListMembersInput.parse(body);
    return this.addHandler.execute({
      tenantId: tenant,
      listId: uuid.parse(id),
      borrowerIds: dto.borrowerIds,
    });
  }

  @Delete('borrower-lists/:id/members/:borrowerId')
  @HttpCode(204)
  async removeMember(
    @Param('id') id: string,
    @Param('borrowerId') borrowerId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, MANAGER_ROLES);
    await this.removeHandler.execute({
      tenantId: tenant,
      listId: uuid.parse(id),
      borrowerId: uuid.parse(borrowerId),
    });
  }
}
