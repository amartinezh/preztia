import { z } from 'zod';
import {
  type RequiredDocumentSpec,
  type RequiredDocumentType,
} from '@preztiaos/domain';
import { fetchWithRetry } from '../../shared/fetch-retry';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Resultado de extraer la información de un documento con un modelo multimodal. */
export interface GeminiDocumentExtraction {
  /** Documento que la IA cree que es (texto libre), o null si no lo identificó. */
  readonly identifiedType: string | null;
  /** ¿Coincide con el documento esperado del checklist? */
  readonly matchesExpected: boolean;
  /** Confianza 0..1. */
  readonly confidence: number;
  /** Datos extraídos (no estructurados): pares clave-valor. */
  readonly fields: Record<string, unknown>;
  /** Texto crudo reconocido en el documento, si aplica. */
  readonly rawText: string | null;
  /** Respuesta cruda del modelo (para trazabilidad). */
  readonly raw: unknown;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

// Parseo TOLERANTE: la extracción es de datos no estructurados, así que ante
// desviaciones del modelo caemos a valores seguros en vez de fallar.
const extractionSchema = z.object({
  identifiedType: z.string().nullable().catch(null),
  matchesExpected: z.boolean().catch(false),
  confidence: z.number().min(0).max(1).catch(0),
  fields: z.record(z.unknown()).catch({}),
  rawText: z.string().nullable().catch(null),
});

// Campos canónicos por tipo de documento: el pipeline antifraude (Etapas 2-3)
// cruza estos nombres exactos contra fuentes oficiales, así que se le piden a
// la IA con estas claves (puede agregar otros campos que reconozca).
const CANONICAL_FIELDS: Partial<Record<RequiredDocumentType, string>> = {
  IDENTITY_DOCUMENT:
    'nome, cpf, data_nascimento (YYYY-MM-DD), data_emissao (YYYY-MM-DD), validade (YYYY-MM-DD), ' +
    'numero_registro, categoria, uf_emissor, nome_pai, nome_mae',
  BUSINESS_VALIDITY_CERTIFICATE:
    'razao_social, cnpj, capital_social (número en reais), ' +
    'qsa (array de objetos {nome_socio, qualificacao}), nire, data_constituicao (YYYY-MM-DD), ' +
    'cep, uf, municipio',
  PUBLIC_SERVICES_RECEIPT:
    'titular, cnpj_emissor, endereco, cep, cidade, uf, data_emissao (YYYY-MM-DD), ' +
    'mes_referencia (MM/YYYY), vencimento (YYYY-MM-DD), valor (número en reais), ' +
    'linha_digitavel (los 48 dígitos del código de barras, solo dígitos), numero_instalacao',
};

function buildPrompt(
  documentType: RequiredDocumentType,
  spec: RequiredDocumentSpec | undefined,
): string {
  const expected = spec?.title ?? documentType;
  const description = spec?.description ?? '';
  const canonical = CANONICAL_FIELDS[documentType];
  const fieldsInstruction = canonical
    ? `Extrae en "fields" estos campos con EXACTAMENTE estas claves (null si no se leen): ${canonical}. Agrega además cualquier otro campo legible.`
    : 'Extrae TODOS los campos legibles del documento (nombres, números, fechas, CPF, CNPJ, dirección, etc.) como pares clave-valor en "fields".';
  return `Eres un verificador KYC para una financiera en BRASIL. Recibes la imagen o PDF de un documento que un solicitante envió por WhatsApp para su solicitud de crédito.

Documento ESPERADO: "${expected}".
Descripción del documento esperado: "${description}".

Tu tarea:
1. Identifica qué documento es realmente (en "identifiedType").
2. Indica si coincide con el documento esperado (en "matchesExpected").
3. ${fieldsInstruction}
4. Devuelve en "rawText" el texto crudo relevante que reconozcas.
5. Estima tu confianza (0 a 1) en "confidence".

Responde EXCLUSIVAMENTE un JSON con esta forma: {"identifiedType": string|null, "matchesExpected": boolean, "confidence": number, "fields": object, "rawText": string|null}.`;
}

/** Llama a Gemini (multimodal) para extraer la información del documento. */
export async function extractWithGemini(input: {
  apiKey: string;
  model: string;
  documentType: RequiredDocumentType;
  spec: RequiredDocumentSpec | undefined;
  media: { bytes: Uint8Array; mimeType: string };
}): Promise<GeminiDocumentExtraction> {
  const url = `${ENDPOINT}/${input.model}:generateContent?key=${input.apiKey}`;
  const base64 = Buffer.from(input.media.bytes).toString('base64');

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: buildPrompt(input.documentType, input.spec) },
            { inlineData: { mimeType: input.media.mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Gemini (extracción) respondió ${res.status}: ${await res.text()}`,
    );
  }

  const data = (await res.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini no devolvió contenido en la extracción');

  const raw: unknown = JSON.parse(text);
  const parsed = extractionSchema.parse(raw);
  return { ...parsed, raw };
}
