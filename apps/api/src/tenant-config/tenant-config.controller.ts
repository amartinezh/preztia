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
  UpdateTenantSettingsHandler,
} from '@preztiaos/application';
import {
  setDocumentRequirementsInput,
  updateAssistantConfigInput,
  updateOperationalSettingsInput,
} from '@preztiaos/contracts';
import { JwtGuard } from '../auth/jwt.guard';
import { requireTenant } from '../auth/require-tenant';
import { requireRole } from '../auth/require-role';
import { TenantConfigRepository } from './tenant-config.repository';
import { AssistantConfigRepository } from './assistant-config.repository';
import { DocumentRequirementsRepository } from './document-requirements.repository';

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

  constructor(
    private readonly config: TenantConfigRepository,
    private readonly assistant: AssistantConfigRepository,
    private readonly documents: DocumentRequirementsRepository,
  ) {
    this.updateHandler = new UpdateTenantSettingsHandler(this.config);
    this.updateAssistantHandler = new UpdateAssistantConfigHandler(
      this.assistant,
    );
    this.setDocumentsHandler = new SetDocumentRequirementsHandler(
      this.documents,
    );
  }

  @Get('tenant-config/operational-settings')
  async get(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const tenant = requireTenant(tenantId);
    requireRole(authorization, ADMIN_ONLY);
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
