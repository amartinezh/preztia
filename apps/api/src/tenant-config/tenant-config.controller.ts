import {
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  SetDocumentRequirementsHandler,
  UpdateAssistantConfigHandler,
  UpdateMessagingChannelsHandler,
  UpdateTenantSettingsHandler,
} from '@preztiaos/application';
import {
  setDocumentRequirementsInput,
  updateAssistantConfigInput,
  updateCollectionReminderSettingsInput,
  updateMessagingChannelsInput,
  updateOperationalSettingsInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { requireReviewer } from '../auth/require-reviewer';
import { TenantConfigRepository } from './tenant-config.repository';
import { AssistantConfigRepository } from './assistant-config.repository';
import { DocumentRequirementsRepository } from './document-requirements.repository';
import { MessagingChannelsRepository } from './messaging-channels.repository';

// La configuración de cobro y del asistente la administra el ADMIN del tenant.
const ADMIN_ONLY = ['ADMIN'] as const;

/**
 * Frontera HTTP de la CONFIGURACIÓN DE COBRO (ajustes operativos) y del ASISTENTE de WhatsApp
 * (base de conocimiento + IA) del tenant.
 */
@Controller()
@UseGuards(JwtGuard)
export class TenantConfigController {
  private readonly updateHandler: UpdateTenantSettingsHandler;
  private readonly updateAssistantHandler: UpdateAssistantConfigHandler;
  private readonly setDocumentsHandler: SetDocumentRequirementsHandler;
  private readonly updateMessagingHandler: UpdateMessagingChannelsHandler;

  constructor(
    private readonly config: TenantConfigRepository,
    private readonly assistant: AssistantConfigRepository,
    private readonly documents: DocumentRequirementsRepository,
    private readonly messaging: MessagingChannelsRepository,
  ) {
    this.updateHandler = new UpdateTenantSettingsHandler(this.config);
    this.updateAssistantHandler = new UpdateAssistantConfigHandler(
      this.assistant,
    );
    this.setDocumentsHandler = new SetDocumentRequirementsHandler(
      this.documents,
    );
    this.updateMessagingHandler = new UpdateMessagingChannelsHandler(
      this.messaging,
    );
  }

  @Get('tenant-config/operational-settings')
  async get(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    // Lectura para revisores (ADMIN/COORDINATOR): el Coordinador la ve en solo lectura.
    // La escritura (PATCH) sigue restringida al ADMIN.
    requireReviewer(authorization);
    return this.config.get(tenant);
  }

  @Patch('tenant-config/operational-settings')
  async update(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const patch = updateOperationalSettingsInput.parse(body);
    return this.updateHandler.execute({ tenantId: tenant, patch });
  }

  @Get('tenant-config/collection-reminder')
  async getCollectionReminder(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    // Lectura para revisores (ADMIN/COORDINATOR); la escritura (PATCH) sigue en ADMIN.
    requireReviewer(authorization);
    return this.config.getReminderSettings(tenant);
  }

  @Patch('tenant-config/collection-reminder')
  async updateCollectionReminder(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const patch = updateCollectionReminderSettingsInput.parse(body);
    return this.config.updateReminderSettings({ tenantId: tenant, patch });
  }

  // Canales de mensajería (ADR #40): lectura para revisores (la UI decide qué proveedores mostrar);
  // la escritura, solo ADMIN. Los invariantes los valida el dominio (400 si se violan).
  @Get('tenant-config/messaging-channels')
  async getMessagingChannels(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireReviewer(authorization);
    return this.messaging.get(tenant);
  }

  @Patch('tenant-config/messaging-channels')
  async updateMessagingChannels(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const patch = updateMessagingChannelsInput.parse(body);
    return this.updateMessagingHandler.execute({ tenantId: tenant, patch });
  }

  @Get('tenant-config/assistant')
  async getAssistant(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    return this.assistant.getView(tenant);
  }

  @Patch('tenant-config/assistant')
  async updateAssistant(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const patch = updateAssistantConfigInput.parse(body);
    return this.updateAssistantHandler.execute({ tenantId: tenant, patch });
  }

  @Get('credit-document-requirements')
  async getDocuments(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    return { items: await this.documents.list(tenant) };
  }

  @Put('credit-document-requirements')
  async setDocuments(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
    const { items } = setDocumentRequirementsInput.parse(body);
    return {
      items: await this.setDocumentsHandler.execute({
        tenantId: tenant,
        items,
      }),
    };
  }
}
