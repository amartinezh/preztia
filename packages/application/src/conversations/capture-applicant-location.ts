import type { LocationMessage } from "@preztiaos/domain";
import type {
  ApplicantLocationStore,
  InboundMessageDeduplicator,
  TenantResolver,
} from "../credit/application/ports";
import type { OutboundTextSender } from "./text/ports";

/**
 * Caso de uso: captura la UBICACIÓN que el cliente comparte por WhatsApp y la persiste en su
 * solicitud de crédito ACTIVA (verificación geográfica). Resuelve el tenant por el canal,
 * deduplica el webhook (idempotencia) y confirma al cliente. Si no hay solicitud activa, se ignora
 * en silencio (la ubicación no aplica a ningún expediente). No conoce HTTP ni Drizzle: orquesta
 * puertos. La decisión de cuándo pedirla vive en el flujo de documentos; aquí solo se recibe.
 */
export class CaptureApplicantLocationHandler {
  constructor(
    private readonly tenants: TenantResolver,
    private readonly dedup: InboundMessageDeduplicator,
    private readonly store: ApplicantLocationStore,
    private readonly sender: OutboundTextSender,
  ) {}

  async execute(message: LocationMessage): Promise<void> {
    const tenantId = await this.tenants.resolveByChannel(message.channelId);
    if (!tenantId) return; // canal sin tenant

    // Idempotencia: un reintento del webhook con el mismo wamid no reescribe ni re-confirma.
    if (!(await this.dedup.firstSeen({ tenantId, messageId: message.id }))) return;

    const saved = await this.store.saveActiveApplicationLocation({
      tenantId,
      applicant: message.from,
      latitude: message.latitude,
      longitude: message.longitude,
    });
    if (!saved) return; // sin solicitud activa: nada que ubicar

    await this.sender.sendText(
      { channelId: message.channelId, recipient: message.from },
      "📍 ¡Gracias! Recibimos tu ubicación. Con esto completamos tu solicitud; un asesor la revisará y nos comunicaremos contigo en el menor tiempo posible.",
    );
  }
}
