import { Injectable } from "@nestjs/common";
import { type ImageMessageDispatcher, SubmitApplicationDocumentHandler } from "@preztiaos/application";
import { type ImageMessage } from "@preztiaos/domain";

/**
 * Adaptador del puerto ImageMessageDispatcher: una imagen entrante puede ser un
 * documento KYC de una solicitud activa. Delega al caso de uso, que decide si
 * forma parte del protocolo (si no hay solicitud activa, la ignora).
 */
@Injectable()
export class ImageDocumentDispatcher implements ImageMessageDispatcher {
  constructor(private readonly submit: SubmitApplicationDocumentHandler) {}

  async dispatch(message: ImageMessage): Promise<void> {
    await this.submit.execute({
      messageId: message.id,
      channelId: message.channelId,
      applicant: message.from,
      media: message.media,
    });
  }
}
