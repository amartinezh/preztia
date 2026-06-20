import {
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SendCollectionReminderHandler } from '@preztiaos/application';
import type { SendReminderOutput } from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireReviewer } from '../auth/require-reviewer';
import { DueCreditsRepository } from './due-credits.repository';

const uuid = z.string().uuid();

/**
 * Frontera HTTP de COBRANZA (vista de Cartera/Gestión de Créditos). El coordinador/ADMIN consulta
 * el panel de cobro de un crédito y dispara el recordatorio de WhatsApp de forma manual e
 * inmediata. La validación de entrada es del contrato; las reglas y el envío, del caso de uso.
 * El abono y el transcript ya quedan cubiertos por el sender (registra el saliente) y el handler
 * (auditoría + idempotencia). Protegida por JWT.
 */
@Controller()
@UseGuards(JwtGuard)
export class CollectionsController {
  constructor(
    private readonly dueCredits: DueCreditsRepository,
    private readonly sendReminder: SendCollectionReminderHandler,
  ) {}

  @Get('credits/:creditId/collection')
  async getCollection(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireReviewer(authorization);
    const panel = await this.dueCredits.getPanel({
      tenantId: tenant,
      creditId: uuid.parse(creditId),
    });
    if (!panel) throw new NotFoundException('Crédito no encontrado');
    return panel;
  }

  @Post('credits/:creditId/collection-reminder')
  @HttpCode(200)
  async send(
    @Param('creditId') creditId: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<SendReminderOutput> {
    const tenant = requireTenant(tenantId);
    const session = requireReviewer(authorization);
    const result = await this.sendReminder.sendForCredit({
      tenantId: tenant,
      creditId: uuid.parse(creditId),
      actorId: session.userId,
    });
    return {
      sent: result.sent,
      reason: result.reason ?? null,
      phone: result.phone ?? null,
      dueMinor: result.dueMinor ?? null,
      currency: result.currency ?? null,
      messagePreview: result.messagePreview ?? null,
    };
  }
}
