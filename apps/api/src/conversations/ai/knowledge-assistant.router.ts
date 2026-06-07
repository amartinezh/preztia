import { Injectable } from "@nestjs/common";
import { AssistantRequest, KnowledgeAssistant } from "@preztiaos/application";
import { AssistantAnswer } from "@preztiaos/domain";
import { askGemini } from "./gemini.client";

/**
 * Adaptador del puerto KnowledgeAssistant: despacha al proveedor configurado por
 * el tenant. Fase 1 implementa GEMINI; OPENAI y CLAUDE llegarán más adelante.
 */
@Injectable()
export class KnowledgeAssistantRouter implements KnowledgeAssistant {
  async answer(request: AssistantRequest): Promise<AssistantAnswer> {
    switch (request.provider) {
      case "GEMINI":
        return askGemini(request);
      case "OPENAI":
      case "CLAUDE":
        throw new Error(`Proveedor de IA '${request.provider}' aún no implementado (la Fase 1 usa GEMINI)`);
    }
  }
}
