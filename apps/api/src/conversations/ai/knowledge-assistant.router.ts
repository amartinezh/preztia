import { Injectable, Logger } from '@nestjs/common';
import { AssistantRequest, KnowledgeAssistant } from '@preztiaos/application';
import { AssistantAnswer } from '@preztiaos/domain';
import { askGemini } from './gemini.client';

/**
 * Adaptador del puerto KnowledgeAssistant: despacha al proveedor configurado por
 * el tenant. Fase 1 implementa GEMINI; OPENAI y CLAUDE llegarán más adelante.
 */
@Injectable()
export class KnowledgeAssistantRouter implements KnowledgeAssistant {
  private readonly logger = new Logger('WhatsApp:Assistant');

  async answer(request: AssistantRequest): Promise<AssistantAnswer> {
    try {
      switch (request.provider) {
        case 'GEMINI':
          return await askGemini(request);
        case 'OPENAI':
        case 'CLAUDE':
          throw new Error(
            `Proveedor de IA '${request.provider}' aún no implementado (la Fase 1 usa GEMINI)`,
          );
      }
    } catch (err) {
      // Observabilidad: el caso de uso degrada con elegancia (responde "no disponible")
      // y descarta el error, así que es aquí donde debe quedar trazado el porqué real
      // (p. ej. 400/429 de Gemini, credencial inválida) para poder diagnosticar.
      this.logger.error(
        `Fallo del asistente (${request.provider})`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }
}
