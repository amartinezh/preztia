import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  TenantAssistantConfig,
  TenantAssistantConfigRepository,
} from '@preztiaos/application';
import {
  resolveTenantByWhatsappPhone,
  withTenantTxFor,
} from '../../tenancy/unit-of-work';
import { decryptOptionalSecret } from '../../shared/secret-cipher';

/**
 * Adaptador: carga la configuración del asistente desde la BD.
 * Resuelve el tenant por el phone_number_id y luego lee tenant_config bajo RLS
 * con el tenant ya fijado (defensa en profundidad: el aislamiento lo aplica PG).
 */
@Injectable()
export class TenantConfigDrizzleRepository implements TenantAssistantConfigRepository {
  private readonly logger = new Logger('WhatsApp:Assistant');

  async findByChannelId(
    channelId: string,
  ): Promise<TenantAssistantConfig | null> {
    const tenantId = await resolveTenantByWhatsappPhone(channelId);
    if (!tenantId) {
      // El número no está mapeado a ningún tenant/zona: el asistente no responderá.
      this.logger.warn(
        `Canal ${channelId} sin tenant asociado (whatsapp_channel)`,
      );
      return null;
    }

    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.tenantConfig)
        .where(eq(schema.tenantConfig.tenantId, tenantId));
      if (!row) return null;

      const aiApiKey = decryptOptionalSecret(row.aiApiKey);
      // El asistente calla si falta la credencial de IA o la base de conocimiento. Sin este
      // aviso el mensaje entrante moría en silencio (se recibía y no se respondía). Se avisa
      // hasta que se configure en Ajustes → WhatsApp/IA (PUT /tenant-config/assistant).
      if (!aiApiKey || row.knowledgeBase.trim() === '') {
        this.logger.warn(
          `Asistente sin configurar para el tenant ${tenantId}: ${!aiApiKey ? 'falta API key de IA' : 'base de conocimiento vacía'}. No se responderá hasta configurarlo en Ajustes → WhatsApp/IA.`,
        );
      }

      return {
        tenantId: row.tenantId,
        knowledgeBase: row.knowledgeBase,
        aiProvider: row.aiProvider,
        // La credencial va CIFRADA en reposo (AES-256-GCM): se descifra al leerla,
        // igual que en el OCR de documentos y el clasificador de pagos.
        aiApiKey,
      };
    });
  }
}
