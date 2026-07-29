import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  conversationFilters,
  conversationStatsQuery,
  createChannelInput,
  deleteConversationsInput,
  listConversationsQuery,
  purgeConversationsInput,
  updateChannelInput,
  type ConversationFilters,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { requireReviewer } from '../auth/require-reviewer';
import { WhatsappChannelRepository } from './whatsapp-channel.repository';
import { ConversationsInboxQueryRepository } from './conversations-inbox-query.repository';
import { ConversationsPurgeRepository } from './conversations-purge.repository';

const uuid = z.string().uuid();
const phone = z.string().regex(/^\d{8,15}$/);
const ADMIN_ONLY = ['ADMIN'] as const;

/** Quita del DTO las claves sin valor: el read model distingue "sin filtro" de "filtro vacío". */
function toFilters(dto: Partial<ConversationFilters>): ConversationFilters {
  return Object.fromEntries(
    Object.entries(dto).filter(([, value]) => value !== undefined),
  );
}

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
    private readonly purge: ConversationsPurgeRepository,
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

  @Patch('whatsapp-channels/:id')
  @HttpCode(204)
  async updateChannel(
    @Param('id') id: string,
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<void> {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const credentials = updateChannelInput.parse(body);
    const ok = await this.channels.updateCredentials({
      tenantId: tenant,
      id: uuid.parse(id),
      credentials,
    });
    if (!ok) throw new NotFoundException('Canal no encontrado');
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
    const { page, pageSize, sort, order, ...filters } =
      listConversationsQuery.parse(query);
    const { items, total } = await this.inbox.listConversations({
      session: reviewer,
      filters: toFilters(filters),
      sort,
      order,
      page,
      pageSize,
    });
    return { items, page, pageSize, total };
  }

  @Get('conversations/stats')
  async conversationStats(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Query() query: Record<string, string>,
  ) {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    return this.inbox.stats({
      session: reviewer,
      filters: toFilters(conversationStatsQuery.parse(query)),
    });
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

  // ── Depuración de la bandeja (ADMIN/COORDINATOR, dentro de su alcance) ──────

  @Post('conversations/delete')
  @HttpCode(200)
  async deleteConversations(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    const { phones } = deleteConversationsInput.parse(body);
    return this.purge.deleteByPhones({ session: reviewer, phones });
  }

  @Post('conversations/purge')
  @HttpCode(200)
  async purgeConversations(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    requireTenant(tenantId);
    const reviewer = requireReviewer(authorization);
    // Dos lecturas del mismo cuerpo con intenciones distintas: la primera EXIGE el
    // consentimiento explícito; la segunda extrae solo los filtros que definen el alcance.
    purgeConversationsInput.parse(body);
    const filters = conversationFilters.parse(body);
    return this.purge.purge({ session: reviewer, filters: toFilters(filters) });
  }
}
