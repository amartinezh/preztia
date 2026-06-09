import { Injectable } from '@nestjs/common';
import {
  type DocumentMessageDispatcher,
  SubmitApplicationDocumentHandler,
} from '@preztiaos/application';
import { type DocumentMessage } from '@preztiaos/domain';

/**
 * Adaptador del puerto DocumentMessageDispatcher: un archivo adjunto (PDF, etc.)
 * entrante puede ser un documento KYC de una solicitud activa. Delega al mismo caso
 * de uso que las imágenes.
 */
@Injectable()
export class FileDocumentDispatcher implements DocumentMessageDispatcher {
  constructor(private readonly submit: SubmitApplicationDocumentHandler) {}

  async dispatch(message: DocumentMessage): Promise<void> {
    await this.submit.execute({
      messageId: message.id,
      channelId: message.channelId,
      applicant: message.from,
      media: message.media,
    });
  }
}
