import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  createChannelInput,
  listConversationsQuery,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { requireReviewer } from '../auth/require-reviewer';
import { WhatsappChannelRepository } from './whatsapp-channel.repository';
import { ConversationsInboxQueryRepository } from './conversations-inbox-query.repository';

const uuid = z.string().uuid();
const phone = z.string().regex(/^\d{8,15}$/);
const ADMIN_ONLY = ['ADMIN'] as const;

/**
 * Frontera HTTP de WhatsApp: canales (número→zona, ADMIN) y bandeja de conversaciones
 * (ADMIN/COORDINATOR, scopeada por zona). Protegida por JWT.
 */
@Controller()
@UseGuards(JwtGuard)
export class WhatsappController {
  constructor(
    private readonly channels: WhatsappChannelRepository,
    private readonly inbox: ConversationsInboxQueryRepository,
  ) {}

  // ── Canales (ADMIN) ────────────────────────────────────────────────────────

  @Get('whatsapp-channels')
  async listChannels(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    return { items: await this.channels.list(tenant) };
  }

  @Post('whatsapp-channels')
  @HttpCode(201)
  async createChannel(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const dto = createChannelInput.parse(body);
    return this.channels.create({ tenantId: tenant, ...dto });
  }

  @Delete('whatsapp-channels/:id')
  @HttpCode(204)
  async deleteChannel(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const ok = await this.channels.remove({
      tenantId: tenant,
      id: uuid.parse(id),
    });
    if (!ok) throw new NotFoundException('Canal no encontrado');
  }

  // ── Bandeja de conversaciones (ADMIN/COORDINATOR, scopeada por zona) ─────────

  @Get('conversations')
  async listConversations(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    const { page, pageSize, search, withApplication } =
      listConversationsQuery.parse(query);
    const { items, total } = await this.inbox.listConversations({
      session: reviewer,
      page,
      pageSize,
      ...(search ? { search } : {}),
      ...(withApplication ? { withApplication } : {}),
    });
    return { items, page, pageSize, total };
  }

  @Get('conversations/thread')
  async thread(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query('phone') phoneParam: string | undefined,
  ) {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    return this.inbox.getThread({
      session: reviewer,
      phone: phone.parse(phoneParam),
    });
  }
}
