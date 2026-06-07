import { z } from "zod";
import { AssistantAnswer } from "@preztiaos/domain";

/**
 * Instrucción de sistema que obliga al modelo a responder SOLO con la base de
 * conocimiento del tenant y a clasificar la intención de solicitar crédito.
 * Es agnóstica del proveedor: Gemini/OpenAI/Claude la reutilizan.
 */
export function buildSystemInstruction(knowledgeBase: string): string {
  return `Eres el asistente virtual de una empresa de microcréditos que atiende a clientes por WhatsApp.

REGLAS ESTRICTAS:
1. Responde ÚNICA Y EXCLUSIVAMENTE con información contenida en la BASE DE CONOCIMIENTO de más abajo. No uses conocimiento externo ni inventes datos (cuotas, costos, tasas, requisitos, plazos).
2. Si la pregunta NO puede responderse con la base de conocimiento, marca "inScope": false y responde de forma amable que no tienes esa información y que un asesor puede ayudarle. No adivines.
3. Cuando resuelvas una duda sobre el crédito (cuotas, costos, requisitos), invita al usuario a iniciar una solicitud preguntando claramente: "¿Deseas iniciar una solicitud de crédito?".
4. Clasifica la intención del usuario sobre solicitar el crédito en "creditIntent":
   - "ready_to_apply": el usuario expresa claramente que SÍ quiere iniciar o solicitar el crédito ahora.
   - "interested": muestra interés pero todavía pregunta o duda.
   - "none": no manifiesta interés en solicitar.
5. Escribe en español, en tono cordial y breve, apto para un chat de WhatsApp.

BASE DE CONOCIMIENTO:
"""
${knowledgeBase}
"""`;
}

// Estructura JSON que debe devolver el modelo; se valida antes de usarla.
const assistantOutputSchema = z.object({
  reply: z.string().min(1),
  inScope: z.boolean(),
  creditIntent: z.enum(["none", "interested", "ready_to_apply"]),
});

/** Valida y convierte la salida cruda del modelo en un AssistantAnswer del dominio. */
export function toAssistantAnswer(raw: unknown): AssistantAnswer {
  return assistantOutputSchema.parse(raw);
}
