import { AssistantRequest } from '@preztiaos/application';
import { AssistantAnswer } from '@preztiaos/domain';
import {
  buildSystemInstruction,
  toAssistantAnswer,
} from './assistant-instructions';
import { fetchWithRetry } from '../../shared/fetch-retry';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.0-flash'; // elegible en la capa gratuita

// Fuerza salida JSON con la forma que espera toAssistantAnswer.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    classification: {
      type: 'string',
      enum: [
        'knowledge_question',
        'credit_application',
        'restart_application',
        'off_topic',
      ],
    },
    reply: { type: 'string' },
  },
  required: ['classification', 'reply'],
};

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** Llama a la API REST de Gemini (capa gratuita) y devuelve la respuesta validada. */
export async function askGemini(
  request: AssistantRequest,
): Promise<AssistantAnswer> {
  const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const url = `${ENDPOINT}/${model}:generateContent?key=${request.apiKey}`;

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: buildSystemInstruction(request.knowledgeBase) }],
      },
      contents: [{ role: 'user', parts: [{ text: request.question }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini respondió ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini no devolvió contenido');

  return toAssistantAnswer(JSON.parse(text));
}
