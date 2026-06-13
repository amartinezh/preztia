import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  type BankPaymentVerifier,
  type BankVerificationResult,
} from '@preztiaos/application';
import { type PixReceiptData } from '@preztiaos/domain';
import { TenantBankAccountDrizzleRepository } from '../../tenant-bank-account.repository';
import { InterApiClient } from './inter-api.client';

const CENTS_PER_UNIT = 100;

// El API de Inter informa el valor como string decimal "1234.56".
const interPixSchema = z.object({
  valor: z.union([z.string(), z.number()]),
  horario: z.string().optional(),
});

/**
 * Adaptador BankPaymentVerifier para Banco Inter (BR). Consulta el PIX por su
 * end-to-end id y traduce la respuesta al veredicto del dominio. NUNCA lanza
 * hacia el caso de uso: cualquier fallo se degrada a "unavailable" para que el
 * pago quede en conciliación en lugar de romper la atención del mensaje.
 */
@Injectable()
export class InterPaymentVerifier implements BankPaymentVerifier {
  private readonly logger = new Logger('Payments:Inter');

  constructor(
    private readonly client: InterApiClient,
    private readonly accounts: TenantBankAccountDrizzleRepository,
  ) {}

  async verify(input: {
    tenantId: string;
    countryCode: string;
    bankCode: string;
    pix: PixReceiptData;
  }): Promise<BankVerificationResult> {
    if (!input.pix.endToEndId) {
      // Sin e2eid no hay forma de consultar: queda para conciliación/analista.
      return {
        verification: {
          status: 'unavailable',
          reason: 'comprobante_sin_end_to_end_id',
        },
      };
    }

    try {
      const apiKey = await this.accounts.findApiKey(input);
      if (!apiKey) {
        return {
          verification: {
            status: 'unavailable',
            reason: 'sin_credencial_bancaria',
          },
        };
      }

      const response = await this.client.queryReceivedPix({
        endToEndId: input.pix.endToEndId,
        apiKey,
      });
      if (!response.found) {
        return {
          verification: { status: 'not_found' },
          rawResponse: response.body,
        };
      }

      const parsed = interPixSchema.safeParse(response.body);
      if (!parsed.success) {
        this.logger.warn(
          'Respuesta de Inter con forma inesperada; pago queda en conciliación',
        );
        return {
          verification: {
            status: 'unavailable',
            reason: 'respuesta_bancaria_inesperada',
          },
          rawResponse: response.body,
        };
      }

      return {
        verification: {
          status: 'confirmed',
          bankAmountMinor: toMinor(parsed.data.valor),
          bankPaidAt: parsed.data.horario ?? null,
        },
        rawResponse: response.body,
      };
    } catch (err) {
      this.logger.error(
        'Fallo consultando el Banco Inter',
        err instanceof Error ? err.stack : String(err),
      );
      return {
        verification: { status: 'unavailable', reason: 'banco_no_disponible' },
      };
    }
  }
}

function toMinor(valor: string | number): number {
  return Math.round(Number(valor) * CENTS_PER_UNIT);
}
