import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { commissionPolicy } from '@preztiaos/contracts';
import {
  PayCollectorCommissionHandler,
  SetZoneCommissionHandler,
  type CommissionActor,
} from '@preztiaos/application';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireReviewer } from '../auth/require-reviewer';
import type { Session } from '../auth/require-role';
import { Idempotent } from '../observability/idempotent.decorator';
import { CommissionSettingsRepository } from './commission-settings.repository';
import { CommissionPaymentRepository } from './commission-payment.repository';

const uuid = z.string().uuid();
const payCommissionInput = z.object({ cashBoxId: uuid });

/** Quién actúa: el ADMIN alcanza todo el tenant; el coordinador, su subárbol de zonas. */
function actorOf(session: Session): CommissionActor {
  return {
    userId: session.userId,
    scopes: session.role === 'ADMIN' ? null : session.zonePaths,
  };
}

/**
 * Frontera HTTP de las COMISIONES del cobrador: configuración por zona (ADMIN/COORDINATOR dentro de
 * su alcance, sin superar el tope del ADMIN) y pago de lo causado en una liquidación cerrada. El
 * cobrador no accede (403 por `requireReviewer`). Valida con zod y delega en los casos de uso.
 */
@Controller()
@UseGuards(JwtGuard)
export class CommissionsController {
  private readonly setZone: SetZoneCommissionHandler;
  private readonly payCommission: PayCollectorCommissionHandler;

  constructor(
    private readonly settings: CommissionSettingsRepository,
    payments: CommissionPaymentRepository,
  ) {
    this.setZone = new SetZoneCommissionHandler(settings);
    this.payCommission = new PayCollectorCommissionHandler(payments);
  }

  @Get('commissions/settings')
  async view(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const actor = actorOf(requireReviewer(auth));
    return this.settings.view({ tenantId: tenant, scopes: actor.scopes });
  }

  @Put('commissions/zones/:zoneId')
  async set(
    @Param('zoneId') zoneId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const actor = actorOf(requireReviewer(auth));
    await this.setZone.execute({
      tenantId: tenant,
      zoneId: uuid.parse(zoneId),
      policy: commissionPolicy.parse(body),
      actor,
    });
    return this.settings.view({ tenantId: tenant, scopes: actor.scopes });
  }

  @Delete('commissions/zones/:zoneId')
  async clear(
    @Param('zoneId') zoneId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    const actor = actorOf(requireReviewer(auth));
    await this.setZone.execute({
      tenantId: tenant,
      zoneId: uuid.parse(zoneId),
      policy: null,
      actor,
    });
    return this.settings.view({ tenantId: tenant, scopes: actor.scopes });
  }

  // Mueve dinero: idempotente por Idempotency-Key y, además, una sola vez por cobrador y liquidación.
  @Post('settlements/:id/commissions/:collectorId/pay')
  @HttpCode(201)
  @Idempotent()
  async pay(
    @Param('id') id: string,
    @Param('collectorId') collectorId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    const actor = actorOf(requireReviewer(auth));
    const { cashBoxId } = payCommissionInput.parse(body);
    return this.payCommission.execute({
      tenantId: tenant,
      settlementId: uuid.parse(id),
      collectorId: uuid.parse(collectorId),
      cashBoxId,
      actor,
    });
  }
}
