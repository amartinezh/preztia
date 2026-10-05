import { z } from 'zod';
import { AssistantAnswer, type ClientLanguage } from '@preztiaos/domain';

// Cómo debe redactar el modelo en cada idioma de atención: nombre del idioma (para la instrucción) y
// la invitación a solicitar, que debe coincidir con lo que el clasificador reconoce como inicio.
const REPLY_LANGUAGE: Record<
  ClientLanguage,
  { readonly name: string; readonly invitation: string }
> = {
  es: {
    name: 'español',
    invitation: '¿Deseas iniciar una solicitud de crédito?',
  },
  'pt-BR': {
    name: 'portugués de Brasil (tratamiento "você", vocabulario local: "parcela", "comprovante", "chave PIX")',
    invitation: 'Você deseja iniciar uma solicitação de crédito?',
  },
};

/**
 * Instrucción de sistema que obliga al modelo a (1) responder SOLO con la base de
 * conocimiento del tenant y (2) clasificar el mensaje en una de tres vías que el
 * chat de apoyo crediticio sabe atender. Es agnóstica del proveedor: Gemini/OpenAI/
 * Claude la reutilizan. `language` es el idioma de atención del tenant: la respuesta se redacta en
 * él aunque la base de conocimiento esté escrita en otro (el modelo la traduce con fidelidad).
 */
export function buildSystemInstruction(
  knowledgeBase: string,
  language: ClientLanguage,
): string {
  const reply = REPLY_LANGUAGE[language];
  return `Eres el asistente virtual de una empresa de microcréditos que atiende a clientes por chat (WhatsApp o Telegram).

Tu primera tarea es CLASIFICAR cada mensaje del usuario en exactamente una de estas categorías (campo "classification"):
- "knowledge_question": el usuario pregunta o conversa sobre el crédito (cuotas, costos, tasas, requisitos, plazos, cómo funciona) o muestra interés sin pedir aún iniciar.
- "credit_application": el usuario expresa claramente que quiere INICIAR o SOLICITAR el crédito ahora (p. ej. "quiero el préstamo", "deseo solicitarlo", "empecemos", "sí, quiero aplicar", "quero o empréstimo", "quero solicitar", "vamos começar", "sim, quero").
- "restart_application": el usuario quiere REINICIAR su solicitud y volver a enviar TODOS los documentos desde cero (p. ej. "quiero ingresar nuevamente los documentos", "empezar de nuevo", "reiniciar mi solicitud", "volver a subir todo", "comencemos otra vez los documentos", "quero enviar os documentos novamente", "começar de novo", "reiniciar minha solicitação").
El usuario puede escribir en español o en portugués: clasifica igual en ambos idiomas.
- "off_topic": el mensaje no tiene relación con el servicio de apoyo crediticio (saludos vacíos no, sino temas ajenos: clima, política, otros productos, etc.).

REGLAS PARA "reply" (solo se usa cuando classification = "knowledge_question"):
1. Responde ÚNICA Y EXCLUSIVAMENTE con información contenida en la BASE DE CONOCIMIENTO de más abajo. No uses conocimiento externo ni inventes datos (cuotas, costos, tasas, requisitos, plazos).
2. Si la pregunta es sobre el crédito pero NO puede responderse con la base de conocimiento, responde de forma amable que no tienes esa información y que un asesor puede ayudarle. No adivines.
3. Cuando resuelvas una duda, invita al usuario a iniciar la solicitud preguntando: "${reply.invitation}".
4. Para "credit_application" y "off_topic" puedes dejar "reply" vacío: el sistema usará su propio mensaje.
5. Escribe SIEMPRE en ${reply.name}, aunque el usuario o la base de conocimiento usen otro idioma: traduce con fidelidad los datos de la base (montos, plazos, requisitos) sin agregar ni cambiar nada. Tono cordial y breve, apto para un chat de mensajería.

BASE DE CONOCIMIENTO:
"""
${knowledgeBase}
"""`;
}

// Estructura JSON que debe devolver el modelo; se valida antes de usarla.
const assistantOutputSchema = z.object({
  classification: z.enum([
    'knowledge_question',
    'credit_application',
    'restart_application',
    'off_topic',
  ]),
  reply: z.string(),
});

/** Valida y convierte la salida cruda del modelo en un AssistantAnswer del dominio. */
export function toAssistantAnswer(raw: unknown): AssistantAnswer {
  return assistantOutputSchema.parse(raw);
}
