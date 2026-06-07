import { Injectable, Logger } from "@nestjs/common";
import { AudioMessageDispatcher } from "@preztiaos/application";
import { AudioMessage } from "@preztiaos/domain";

/**
 * Adaptador: prepara los audios para el servicio de transcripción.
 *
 * Por ahora solo deja trazada la referencia del media. Más adelante este
 * adaptador publicará el trabajo en una cola (Redis) para que lo consuma un
 * contenedor independiente especializado en audio de WhatsApp.
 */
@Injectable()
export class AudioDispatchAdapter implements AudioMessageDispatcher {
  private readonly logger = new Logger("WhatsApp:Audio");

  async dispatch(message: AudioMessage): Promise<void> {
    // TODO: encolar { mediaId, mimeType, from, channelId } hacia el servicio de transcripción.
    this.logger.log(
      `🎙️  audio preparado para transcripción · mediaId=${message.media.mediaId} mime=${message.media.mimeType} de=${message.from}`,
    );
  }
}
