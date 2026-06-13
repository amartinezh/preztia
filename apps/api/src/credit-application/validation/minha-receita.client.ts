import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { type CnpjRegistryLookup } from '@preztiaos/application';
import { type CnpjRegistryRecord } from '@preztiaos/domain';
import { fetchWithRetry } from '../../shared/fetch-retry';

// Fuente primaria (gratuita, datos de la Receita Federal). Self-hosteable: la
// URL es configurable por entorno para apuntar a una instancia propia.
const DEFAULT_MINHA_RECEITA_URL = 'https://minhareceita.org';
// Fallback gratuito con los mismos datos (usa Minha Receita por debajo).
const BRASILAPI_CNPJ_URL = 'https://brasilapi.com.br/api/cnpj/v1';

const HTTP_NOT_FOUND = 404;
const CENTS_PER_UNIT = 100;

// Parseo TOLERANTE: solo se exigen los campos que las reglas usan; el resto cae
// a null sin tumbar la consulta (las dos fuentes difieren en campos accesorios).
const qsaSchema = z
  .array(z.object({ nome_socio: z.string() }).passthrough())
  .catch([]);
const registrySchema = z
  .object({
    cnpj: z.string(),
    razao_social: z.string(),
    descricao_situacao_cadastral: z.string().nullable().catch(null),
    data_inicio_atividade: z.string().nullable().catch(null),
    cnae_fiscal: z.union([z.number(), z.string()]).nullable().catch(null),
    cnae_fiscal_descricao: z.string().nullable().catch(null),
    municipio: z.string().nullable().catch(null),
    uf: z.string().nullable().catch(null),
    cep: z.union([z.string(), z.number()]).nullable().catch(null),
    capital_social: z.number().nullable().catch(null),
    qsa: qsaSchema,
  })
  .passthrough();

/**
 * Adaptador del puerto CnpjRegistryLookup: registro oficial del CNPJ contra
 * Minha Receita, con BrasilAPI como segunda fuente de disponibilidad.
 * Devuelve null cuando AMBAS fuentes afirman que el CNPJ no existe (404);
 * lanza cuando ninguna fuente pudo responder (el caso de uso degrada a BAJA).
 */
@Injectable()
export class MinhaReceitaCnpjRegistry implements CnpjRegistryLookup {
  private readonly logger = new Logger('Antifraud:CnpjRegistry');

  async findByCnpj(cnpj: string): Promise<CnpjRegistryRecord | null> {
    const baseUrl = process.env.MINHA_RECEITA_URL ?? DEFAULT_MINHA_RECEITA_URL;
    try {
      return await this.query(`${baseUrl}/${cnpj}`);
    } catch (err) {
      this.logger.warn(
        `Minha Receita no disponible para el CNPJ consultado; intentando BrasilAPI (${String(err)})`,
      );
      return this.query(`${BRASILAPI_CNPJ_URL}/${cnpj}`);
    }
  }

  private async query(url: string): Promise<CnpjRegistryRecord | null> {
    const res = await fetchWithRetry(url, {
      headers: { accept: 'application/json' },
    });
    if (res.status === HTTP_NOT_FOUND) return null; // la fuente respondió: no existe
    if (!res.ok) throw new Error(`registro CNPJ respondió ${res.status}`);
    return toRecord(registrySchema.parse(await res.json()));
  }
}

function toRecord(data: z.infer<typeof registrySchema>): CnpjRegistryRecord {
  return {
    cnpj: data.cnpj,
    razonSocial: data.razao_social,
    situacionCadastral: data.descricao_situacao_cadastral ?? 'DESCONOCIDA',
    fechaInicioActividad: data.data_inicio_atividade,
    cnaeFiscal: data.cnae_fiscal !== null ? String(data.cnae_fiscal) : null,
    cnaeDescripcion: data.cnae_fiscal_descricao,
    municipio: data.municipio,
    uf: data.uf,
    cep: data.cep !== null ? String(data.cep) : null,
    capitalSocialMinor:
      data.capital_social !== null
        ? Math.round(data.capital_social * CENTS_PER_UNIT)
        : null,
    socios: data.qsa.map((socio) => socio.nome_socio),
  };
}
