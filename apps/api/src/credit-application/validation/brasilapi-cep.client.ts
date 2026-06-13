import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { type CepLookup } from '@preztiaos/application';
import { type CepRecord } from '@preztiaos/domain';
import { fetchWithRetry } from '../../shared/fetch-retry';

const BRASILAPI_CEP_URL = 'https://brasilapi.com.br/api/cep/v2';
const VIACEP_URL = 'https://viacep.com.br/ws';
const HTTP_NOT_FOUND = 404;

const brasilApiSchema = z
  .object({
    cep: z.string(),
    state: z.string(),
    city: z.string(),
    street: z.string().nullable().catch(null),
  })
  .passthrough();

// ViaCEP responde 200 con {"erro": true} cuando el CEP no existe.
const viaCepSchema = z
  .object({
    erro: z.union([z.boolean(), z.string()]).optional(),
    cep: z.string().optional(),
    uf: z.string().optional(),
    localidade: z.string().optional(),
    logradouro: z.string().optional(),
  })
  .passthrough();

/**
 * Adaptador del puerto CepLookup: catálogo postal vía BrasilAPI CEP v2, con
 * ViaCEP como segunda fuente. null = el CEP no existe; lanza si ambas caen.
 */
@Injectable()
export class BrasilApiCepLookup implements CepLookup {
  private readonly logger = new Logger('Antifraud:CepLookup');

  async findByCep(cep: string): Promise<CepRecord | null> {
    try {
      return await this.queryBrasilApi(cep);
    } catch (err) {
      this.logger.warn(
        `BrasilAPI CEP no disponible; intentando ViaCEP (${String(err)})`,
      );
      return this.queryViaCep(cep);
    }
  }

  private async queryBrasilApi(cep: string): Promise<CepRecord | null> {
    const res = await fetchWithRetry(`${BRASILAPI_CEP_URL}/${cep}`, {
      headers: { accept: 'application/json' },
    });
    if (res.status === HTTP_NOT_FOUND) return null;
    if (!res.ok) throw new Error(`BrasilAPI CEP respondió ${res.status}`);
    const data = brasilApiSchema.parse(await res.json());
    return {
      cep: data.cep,
      state: data.state,
      city: data.city,
      street: data.street,
    };
  }

  private async queryViaCep(cep: string): Promise<CepRecord | null> {
    const res = await fetchWithRetry(`${VIACEP_URL}/${cep}/json/`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`ViaCEP respondió ${res.status}`);
    const data = viaCepSchema.parse(await res.json());
    if (data.erro || !data.uf || !data.localidade) return null;
    return {
      cep: data.cep ?? cep,
      state: data.uf,
      city: data.localidade,
      street: data.logradouro ?? null,
    };
  }
}
