import { Injectable } from '@nestjs/common';
import {
  type BankPaymentVerifier,
  type BankVerificationResult,
} from '@preztiaos/application';
import { type PixReceiptData } from '@preztiaos/domain';

/**
 * Registro de verificadores bancarios por (país, entidad): implementa el puerto
 * BankPaymentVerifier resolviendo el adaptador con la clave "PAÍS:BANCO".
 *
 * PUNTO DE EXTENSIÓN: para soportar un banco nuevo se crea su adaptador y se
 * registra en el módulo con su clave (ej. "BR:ITAU") — application no cambia.
 * Una clave desconocida degrada a "unavailable" (el pago queda en conciliación).
 */
@Injectable()
export class BankVerifierRegistry implements BankPaymentVerifier {
  constructor(private readonly verifiers: ReadonlyMap<string, BankPaymentVerifier>) {}

  async verify(input: {
    tenantId: string;
    countryCode: string;
    bankCode: string;
    pix: PixReceiptData;
  }): Promise<BankVerificationResult> {
    const verifier = this.verifiers.get(`${input.countryCode}:${input.bankCode}`);
    if (!verifier) {
      return { verification: { status: 'unavailable', reason: 'banco_no_soportado' } };
    }
    return verifier.verify(input);
  }
}
