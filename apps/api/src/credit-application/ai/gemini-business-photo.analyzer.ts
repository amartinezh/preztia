import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  BusinessPhotoVerdict,
  BusinessPhotoVisionAnalyzer,
  BusinessRegistrySnapshot,
  DownloadedMedia,
} from '@preztiaos/application';
import { fetchWithRetry } from '../../shared/fetch-retry';
import { decryptOptionalSecret } from '../../shared/secret-cipher';
import { withTenantTxFor, type Tx } from '../../tenancy/unit-of-work';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash'; // multimodal (imágenes)

const PROMPT = `Eres un analista ANTIFRAUDE de una financiera. Recibes la FOTO del local de un
negocio (fachada o interior) y los DATOS de su registro comercial. Evalúa si la foto corresponde
a un negocio REAL y COHERENTE con el registro: razón social/rótulo, tipo de actividad y, si es
visible, la dirección. Detecta señales de fraude: captura de pantalla, imagen genérica de internet,
local que no corresponde a la actividad declarada, foto borrosa/irrelevante, etc.

Datos del registro comercial:
{{registry}}

Responde EXCLUSIVAMENTE un JSON con esta forma:
{"riskLevel":"LOW"|"MEDIUM"|"HIGH","veracityScore":0-100,"matchesRegistry":boolean,
"inconsistencies":[string],"summary":string}
- veracityScore: 100 = totalmente verosímil y coherente; 0 = casi seguro fraude.
- inconsistencies: lista breve de hallazgos concretos (vacía si todo es coherente).
- summary: 1-2 frases con tu dictamen.`;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

const verdictSchema = z.object({
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).catch('MEDIUM'),
  veracityScore: z.number().min(0).max(100).catch(0),
  matchesRegistry: z.boolean().catch(false),
  inconsistencies: z.array(z.string()).catch([]),
  summary: z.string().catch(''),
});

/**
 * Adaptador del puerto BusinessPhotoVisionAnalyzer. Reúne el snapshot del registro comercial (de la
 * extracción del certificado), llama a Gemini multimodal con la foto del local + esos datos, parsea
 * el dictamen antifraude y lo PERSISTE como una extracción de tipo BUSINESS_PHOTO (trazabilidad y
 * fuente del panel de revisión). Credencial de IA por tenant. Si la IA falla, devuelve null.
 */
@Injectable()
export class GeminiBusinessPhotoAnalyzer implements BusinessPhotoVisionAnalyzer {
  private readonly logger = new Logger('CreditApplication:VisionAntifraud');

  async analyze(input: {
    tenantId: string;
    applicationId: string;
    applicantPhone: string;
    mediaId: string;
    photo: DownloadedMedia;
  }): Promise<BusinessPhotoVerdict | null> {
    try {
      const apiKey = await this.resolveApiKey(input.tenantId);
      if (!apiKey) {
        this.logger.warn(
          `Sin credencial de IA para el tenant ${input.tenantId}; no se analiza la foto del local`,
        );
        return null;
      }
      const registry = await this.loadRegistrySnapshot(
        input.tenantId,
        input.applicationId,
      );
      const verdict = await this.callGemini(apiKey, input.photo, registry);
      await this.persist(input, verdict);
      this.logger.log(
        `🏪 Foto del local (app ${input.applicationId}) riesgo=${verdict.riskLevel} veracidad=${verdict.veracityScore} coincide=${verdict.matchesRegistry}`,
      );
      return verdict;
    } catch (err) {
      this.logger.error(
        `Fallo analizando la foto del local (solicitud ${input.applicationId})`,
        err instanceof Error ? err.stack : String(err),
      );
      return null;
    }
  }

  private async callGemini(
    apiKey: string,
    photo: DownloadedMedia,
    registry: BusinessRegistrySnapshot,
  ): Promise<BusinessPhotoVerdict> {
    const model = process.env.GEMINI_VISION_MODEL ?? DEFAULT_MODEL;
    const url = `${ENDPOINT}/${model}:generateContent?key=${apiKey}`;
    const prompt = PROMPT.replace('{{registry}}', JSON.stringify(registry));
    const base64 = Buffer.from(photo.bytes).toString('base64');

    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: photo.mimeType, data: base64 } },
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
        `Gemini (visión local) respondió ${res.status}: ${await res.text()}`,
      );
    }
    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text)
      throw new Error('Gemini no devolvió contenido en el análisis de visión');

    const parsed = verdictSchema.parse(JSON.parse(text));
    return {
      riskLevel: parsed.riskLevel,
      veracityScore: Math.round(parsed.veracityScore),
      matchesRegistry: parsed.matchesRegistry,
      inconsistencies: parsed.inconsistencies,
      summary: parsed.summary,
    };
  }

  // Snapshot del registro comercial desde la extracción del certificado (la más reciente).
  private loadRegistrySnapshot(
    tenantId: string,
    applicationId: string,
  ): Promise<BusinessRegistrySnapshot> {
    return withTenantTxFor(tenantId, async (tx) => {
      const [row] = await tx
        .select({ fields: schema.documentExtraction.fields })
        .from(schema.documentExtraction)
        .where(
          and(
            eq(schema.documentExtraction.applicationId, applicationId),
            eq(
              schema.documentExtraction.documentType,
              'BUSINESS_VALIDITY_CERTIFICATE',
            ),
          ),
        )
        .orderBy(desc(schema.documentExtraction.createdAt))
        .limit(1);
      const f = row?.fields ?? {};
      const str = (v: unknown): string | null =>
        typeof v === 'string' && v ? v : null;
      return {
        legalName: str(f.razao_social),
        tradeName: str(f.nome_fantasia),
        address: str(f.endereco) ?? str(f.municipio),
        activity: str(f.atividade) ?? str(f.cnae),
      };
    });
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

  // Persiste el veredicto como extracción BUSINESS_PHOTO: pasa a ser la más reciente del detalle.
  private persist(
    input: {
      tenantId: string;
      applicationId: string;
      applicantPhone: string;
      mediaId: string;
    },
    verdict: BusinessPhotoVerdict,
  ): Promise<void> {
    return withTenantTxFor(input.tenantId, async (tx: Tx) => {
      await tx.insert(schema.documentExtraction).values({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
        documentType: 'BUSINESS_PHOTO',
        applicantPhone: input.applicantPhone,
        mediaId: input.mediaId,
        provider: 'GEMINI',
        model: process.env.GEMINI_VISION_MODEL ?? DEFAULT_MODEL,
        identifiedType: 'business_photo',
        matchesExpected: verdict.matchesRegistry,
        confidence: verdict.veracityScore,
        fields: { ...verdict, inconsistencies: [...verdict.inconsistencies] },
        rawResponse: { ...verdict },
      });
    });
  }
}
