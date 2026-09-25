import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  RegisterTelegramChannelHandler,
  RemoveTelegramChannelHandler,
  RotateTelegramBotTokenHandler,
  VerifyTelegramWebhookHandler,
} from '@preztiaos/application';
import {
  createTelegramChannelInput,
  updateTelegramChannelInput,
  type TelegramWebhookStatus,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { TelegramChannelRepository } from './telegram-channel.repository';

const uuid = z.string().uuid();
const ADMIN_ONLY = ['ADMIN'] as const;

/**
 * Frontera HTTP de los bots de Telegram por zona (ADMIN, ADR #40): valida la entrada con el
 * contrato y delega en los casos de uso. Los errores de dominio los traduce el filtro global.
 */
@Controller('telegram-channels')
@UseGuards(JwtGuard)
export class TelegramChannelController {
  private readonly logger = new Logger('Telegram:Channels');

  constructor(
    private readonly channels: TelegramChannelRepository,
    private readonly register: RegisterTelegramChannelHandler,
    private readonly rotate: RotateTelegramBotTokenHandler,
    private readonly verify: VerifyTelegramWebhookHandler,
    private readonly removeChannel: RemoveTelegramChannelHandler,
  ) {}

  @Get()
  async list(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    return { items: await this.channels.list(tenant) };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const dto = createTelegramChannelInput.parse(body);
    return this.register.execute({ tenantId: tenant, ...dto });
  }

  @Patch(':id')
  @HttpCode(204)
  async update(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const { botToken } = updateTelegramChannelInput.parse(body);
    await this.rotate.execute({
      tenantId: tenant,
      id: uuid.parse(id),
      botToken,
    });
  }

  @Post(':id/verify')
  @HttpCode(200)
  async verifyWebhook(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<TelegramWebhookStatus> {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const status = await this.verify.execute({
      tenantId: tenant,
      id: uuid.parse(id),
    });
    return {
      ...status,
      lastErrorAt: status.lastErrorAt?.toISOString() ?? null,
    };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const { webhookDeleted } = await this.removeChannel.execute({
      tenantId: tenant,
      id: uuid.parse(id),
    });
    if (!webhookDeleted) {
      // El canal ya no existe localmente: el webhook huérfano quedará rechazado (403).
      this.logger.warn(
        `Canal ${id} eliminado sin confirmación de Telegram del retiro del webhook`,
      );
    }
  }
}
