import { Injectable } from '@nestjs/common';
import {
  type BankPaymentVerifier,
  type BankVerificationResult,
} from '@preztiaos/application';

/**
 * Verificador nulo: responde siempre "unavailable". Permite operar (con
 * política HOLD/ALLOCATE) mientras un banco no tiene adaptador o credenciales;
 * la conciliación batch reintentará cuando exista uno real.
 */
@Injectable()
export class NullBankVerifier implements BankPaymentVerifier {
  verify(): Promise<BankVerificationResult> {
    return Promise.resolve({
      verification: { status: 'unavailable', reason: 'banco_no_soportado' },
    });
  }
}
