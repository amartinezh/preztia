import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  type DownloadedMedia,
  type MediaClassifier,
} from '@preztiaos/application';
import {
  type MediaClassification,
  type PixReceiptData,
} from '@preztiaos/domain';
import { fetchWithRetry } from '../../shared/fetch-retry';
import { decryptOptionalSecret } from '../../shared/secret-cipher';
import { withTenantTxFor } from '../../tenancy/unit-of-work';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash'; // multimodal (imágenes y PDF)

const PROMPT = `Eres un analista financiero de una financiera en BRASIL. Recibes la imagen o PDF de un archivo que un cliente envió por WhatsApp.

Tu tarea tiene dos partes:

1. CLASIFICA el archivo en "kind":
   - "payment_receipt": comprobante de pago/transferencia (por lo general un comprobante PIX de cualquier banco brasileño).
   - "kyc_document": documento de identidad o de la solicitud de crédito (cédula/RG/CNH, certificado, recibo de servicios, extracto, etc.).
   - "unknown": cualquier otra cosa.
   Estima tu confianza (0 a 1) en "confidence".

2. Si es "payment_receipt", EXTRAE en "pix" TODOS los campos legibles del comprobante:
   - "amount": el monto pagado EXACTAMENTE como aparece impreso (ej. "R$ 1.234,56").
   - "currency": código ISO de la moneda (BRL si es un PIX).
   - "paidAt": fecha y hora del pago en ISO 8601, o null.
   - "payerName", "payerTaxId" (CPF/CNPJ del pagador), "payerBankName" (banco emisor).
   - "receiverName", "receiverPixKey" (chave PIX del recebedor).
   - "endToEndId" (identificador E2E del PIX, empieza por "E"), "txid".
   - "extra": objeto con TODOS los demás campos que reconozcas (agencia, cuenta, protocolo, etc.).

Responde EXCLUSIVAMENTE un JSON con esta forma:
{"kind": "payment_receipt"|"kyc_document"|"unknown", "confidence": number, "pix": {"amount": string|null, "currency": string, "paidAt": string|null, "payerName": string|null, "payerTaxId": string|null, "payerBankName": string|null, "receiverName": string|null, "receiverPixKey": string|null, "endToEndId": string|null, "txid": string|null, "extra": object} | null}`;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

// Parseo TOLERANTE: ante desviaciones del modelo caemos a valores seguros.
const pixSchema = z
  .object({
    amount: z.union([z.string(), z.number()]).nullable().catch(null),
    currency: z.string().catch('BRL'),
    paidAt: z.string().nullable().catch(null),
    payerName: z.string().nullable().catch(null),
    payerTaxId: z.string().nullable().catch(null),
    payerBankName: z.string().nullable().catch(null),
    receiverName: z.string().nullable().catch(null),
    receiverPixKey: z.string().nullable().catch(null),
    endToEndId: z.string().nullable().catch(null),
    txid: z.string().nullable().catch(null),
    extra: z.record(z.unknown()).catch({}),
  })
  .nullable()
  .catch(null);

const classificationSchema = z.object({
  kind: z.enum(['payment_receipt', 'kyc_document', 'unknown']).catch('unknown'),
  confidence: z.number().min(0).max(1).catch(0),
  pix: pixSchema,
});

/**
 * Adaptador del puerto MediaClassifier: una sola llamada multimodal a Gemini
 * clasifica el media (¿comprobante de pago o documento KYC?) y, si es un
 * comprobante, extrae TODOS los campos del PIX. Credencial de IA por tenant
 * (tenant_config). Si la IA falla, devuelve "unknown" (degradación elegante).
 */
@Injectable()
export class GeminiPaymentClassifier implements MediaClassifier {
  private readonly logger = new Logger('Payments:Classifier');

  async classify(input: {
    tenantId: string;
    media: DownloadedMedia;
  }): Promise<MediaClassification> {
    try {
      const apiKey = await this.resolveApiKey(input.tenantId);
      if (!apiKey) {
        this.logger.warn(
          `Sin credencial de IA para el tenant ${input.tenantId}; media sin clasificar`,
        );
        return { kind: 'unknown', confidence: 0 };
      }
      return await this.callGemini(apiKey, input.media);
    } catch (err) {
      this.logger.error(
        'Fallo clasificando el media entrante',
        err instanceof Error ? err.stack : String(err),
      );
      return { kind: 'unknown', confidence: 0 };
    }
  }

  private async callGemini(
    apiKey: string,
    media: DownloadedMedia,
  ): Promise<MediaClassification> {
    const model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
    const url = `${ENDPOINT}/${model}:generateContent?key=${apiKey}`;
    const base64 = Buffer.from(media.bytes).toString('base64');

    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: PROMPT },
              { inlineData: { mimeType: media.mimeType, data: base64 } },
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
        `Gemini (clasificación) respondió ${res.status}: ${await res.text()}`,
      );
    }

    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text)
      throw new Error('Gemini no devolvió contenido en la clasificación');

    const parsed = classificationSchema.parse(JSON.parse(text));
    if (parsed.kind !== 'payment_receipt') {
      return { kind: parsed.kind, confidence: parsed.confidence };
    }
    return {
      kind: 'payment_receipt',
      confidence: parsed.confidence,
      pix: toPixReceipt(parsed.pix),
    };
  }

  private resolveApiKey(tenantId: string): Promise<string | null> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({ apiKey: schema.tenantConfig.aiApiKey })
        .from(schema.tenantConfig)
        .where(eq(schema.tenantConfig.tenantId, tenantId));
      return decryptOptionalSecret(row?.apiKey);
    });
  }
}

type ParsedPix = NonNullable<z.infer<typeof pixSchema>>;

function toPixReceipt(pix: ParsedPix | null): PixReceiptData {
  return {
    amountMinor: parseAmountToMinor(pix?.amount ?? null),
    currency: pix?.currency ?? 'BRL',
    paidAt: pix?.paidAt ?? null,
    payerName: pix?.payerName ?? null,
    payerTaxId: pix?.payerTaxId ?? null,
    payerBankName: pix?.payerBankName ?? null,
    receiverName: pix?.receiverName ?? null,
    receiverPixKey: pix?.receiverPixKey ?? null,
    endToEndId: pix?.endToEndId ?? null,
    txid: pix?.txid ?? null,
    raw: pix?.extra ?? {},
  };
}

const CENTS_PER_UNIT = 100;

/**
 * Convierte el monto impreso del comprobante a unidades menores (centavos).
 * Acepta formato pt-BR ("R$ 1.234,56"), formato con punto decimal ("1234.56")
 * y números. Devuelve null si no es interpretable (el dominio lo rechazará).
 */
export function parseAmountToMinor(
  value: string | number | null,
): number | null {
  if (value === null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * CENTS_PER_UNIT) : null;
  }

  const digits = value.replace(/[^\d.,-]/g, '');
  if (!digits) return null;

  // Con coma y punto: el separador decimal es el que aparece de último.
  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  let normalized: string;
  if (lastComma > lastDot) {
    normalized = digits.replace(/\./g, '').replace(',', '.'); // pt-BR: 1.234,56
  } else if (lastDot > lastComma) {
    normalized = digits.replace(/,/g, ''); // en-US: 1,234.56
  } else {
    normalized = digits;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * CENTS_PER_UNIT) : null;
}
