import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { type BankBalanceProvider } from '@preztiaos/application';
import { type BankBalanceVerdict } from '@preztiaos/domain';
import { InterBalanceClient } from './inter-balance.client';

const CENTS_PER_UNIT = 100;

// El API de Inter informa el saldo como número/decimal en `disponivel`.
const interBalanceSchema = z.object({
  disponivel: z.union([z.string(), z.number()]),
});

/**
 * Adaptador BankBalanceProvider para Banco Inter (BR). Consulta el saldo disponible y lo
 * traduce a unidades menores. NUNCA lanza hacia el caso de uso: cualquier fallo (sin
 * credencial, red, forma inesperada) se degrada a "unavailable" para que la conciliación
 * quede como no disponible en vez de romper.
 */
@Injectable()
export class InterBalanceProvider implements BankBalanceProvider {
  private readonly logger = new Logger('Cash:InterBalance');

  constructor(private readonly client: InterBalanceClient) {}

  async fetchBalance(input: {
    apiKey: string | null;
  }): Promise<BankBalanceVerdict> {
    if (!input.apiKey) {
      return { kind: 'unavailable', reason: 'sin_credencial_bancaria' };
    }
    try {
      const res = await this.client.queryBalance({ apiKey: input.apiKey });
      if (!res.ok) {
        return { kind: 'unavailable', reason: 'banco_no_disponible' };
      }
      const parsed = interBalanceSchema.safeParse(res.body);
      if (!parsed.success) {
        this.logger.warn(
          'Saldo de Inter con forma inesperada; conciliación no disponible',
        );
        return { kind: 'unavailable', reason: 'respuesta_bancaria_inesperada' };
      }
      return {
        kind: 'available',
        balanceMinor: toMinor(parsed.data.disponivel),
      };
    } catch (err) {
      this.logger.error(
        'Fallo consultando el saldo del Banco Inter',
        err instanceof Error ? err.stack : String(err),
      );
      return { kind: 'unavailable', reason: 'banco_no_disponible' };
    }
  }
}

function toMinor(valor: string | number): number {
  return Math.round(Number(valor) * CENTS_PER_UNIT);
}
