import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { type DddLookup } from '@preztiaos/application';
import { fetchWithRetry } from '../../shared/fetch-retry';

const BRASILAPI_DDD_URL = 'https://brasilapi.com.br/api/ddd/v1';
const HTTP_NOT_FOUND = 404;

const dddSchema = z.object({ state: z.string() }).passthrough();

/** Adaptador del puerto DddLookup: estado de un DDD telefónico vía BrasilAPI. */
@Injectable()
export class BrasilApiDddLookup implements DddLookup {
  async findByDdd(ddd: string): Promise<{ state: string } | null> {
    const res = await fetchWithRetry(`${BRASILAPI_DDD_URL}/${ddd}`, {
      headers: { accept: 'application/json' },
    });
    if (res.status === HTTP_NOT_FOUND) return null;
    if (!res.ok) throw new Error(`BrasilAPI DDD respondió ${res.status}`);
    const data = dddSchema.parse(await res.json());
    return { state: data.state };
  }
}
