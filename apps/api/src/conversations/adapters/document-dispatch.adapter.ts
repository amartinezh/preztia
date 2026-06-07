import { Injectable, Logger } from "@nestjs/common";
import { ImageMessageDispatcher } from "@preztiaos/application";
import { ImageMessage } from "@preztiaos/domain";

/**
 * Adaptador: envía las imágenes adjuntas al servicio de documentos.
 *
 * Por ahora solo deja trazada la referencia del media. Más adelante este
 * adaptador descargará el binario y lo entregará al servicio de documentos
 * (MinIO + procesamiento de KYC/comprobantes).
 */
@Injectable()
export class DocumentDispatchAdapter implements ImageMessageDispatcher {
  private readonly logger = new Logger("WhatsApp:Image");

  async dispatch(message: ImageMessage): Promise<void> {
    // TODO: descargar el media y entregarlo al servicio de documentos.
    this.logger.log(
      `🖼️  imagen enviada al servicio de documentos · mediaId=${message.media.mediaId} mime=${message.media.mimeType} de=${message.from}`,
    );
  }
}
