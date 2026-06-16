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
  CreatePaymentPlanHandler,
  DeletePaymentPlanHandler,
  SetDefaultPaymentPlanHandler,
  UpdatePaymentPlanHandler,
} from '@preztiaos/application';
import {
  createPaymentPlanInput,
  paginationQuery,
  updatePaymentPlanInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../../auth/jwt.guard';
import { requireTenant } from '../../auth/require-tenant';
import { requireRole } from '../../auth/require-role';
import { PaymentPlanRepository } from './payment-plan.repository';

const uuid = z.string().uuid();

// Los planes de pago los administra el ADMIN del tenant (igual que la configuración de cobro).
const ADMIN_ONLY = ['ADMIN'] as const;

/**
 * Frontera HTTP de los PLANES DE PAGO: valida con zod (contrato), exige JWT + rol ADMIN y delega.
 * No contiene reglas de negocio ni SQL; los `DomainError` de los casos de uso (404/409) los
 * traduce el filtro global de excepciones a su código HTTP.
 */
@Controller()
@UseGuards(JwtGuard)
export class PaymentPlanController {
  private readonly createHandler: CreatePaymentPlanHandler;
  private readonly updateHandler: UpdatePaymentPlanHandler;
  private readonly setDefaultHandler: SetDefaultPaymentPlanHandler;
  private readonly deleteHandler: DeletePaymentPlanHandler;

  constructor(private readonly plans: PaymentPlanRepository) {
    this.createHandler = new CreatePaymentPlanHandler(this.plans);
    this.updateHandler = new UpdatePaymentPlanHandler(this.plans);
    this.setDefaultHandler = new SetDefaultPaymentPlanHandler(this.plans);
    this.deleteHandler = new DeletePaymentPlanHandler(this.plans);
  }

  @Get('payment-plans')
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const { page, pageSize } = paginationQuery.parse(query);
    const { items, total } = await this.plans.list({
      tenantId: tenant,
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Post('payment-plans')
  @HttpCode(201)
  async create(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const dto = createPaymentPlanInput.parse(body);
    return this.createHandler.execute({ tenantId: tenant, plan: dto });
  }

  @Patch('payment-plans/:id')
  async update(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const patch = updatePaymentPlanInput.parse(body);
    return this.updateHandler.execute({
      tenantId: tenant,
      id: uuid.parse(id),
      patch,
    });
  }

  @Post('payment-plans/:id/default')
  @HttpCode(200)
  async setDefault(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    return this.setDefaultHandler.execute({
      tenantId: tenant,
      id: uuid.parse(id),
    });
  }

  @Delete('payment-plans/:id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    await this.deleteHandler.execute({ tenantId: tenant, id: uuid.parse(id) });
  }
}
