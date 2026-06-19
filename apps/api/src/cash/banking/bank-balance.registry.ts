import { Injectable } from '@nestjs/common';
import { type BankBalanceProvider } from '@preztiaos/application';
import { type BankBalanceVerdict } from '@preztiaos/domain';

/**
 * Registro de proveedores de saldo bancario por (país, entidad): implementa el puerto
 * BankBalanceProvider resolviendo el adaptador con la clave "PAÍS:BANCO".
 *
 * PUNTO DE EXTENSIÓN: para soportar la conciliación de un banco nuevo se crea su adaptador y
 * se registra con su clave (ej. "BR:ITAU"); la aplicación no cambia. Una clave desconocida
 * degrada a "unavailable" (la UI mostrará la conciliación como no disponible, no como descuadre).
 */
@Injectable()
export class BankBalanceProviderRegistry implements BankBalanceProvider {
  constructor(
    private readonly providers: ReadonlyMap<string, BankBalanceProvider>,
  ) {}

  async fetchBalance(input: {
    tenantId: string;
    countryCode: string;
    bankCode: string;
    apiKey: string | null;
  }): Promise<BankBalanceVerdict> {
    const provider = this.providers.get(
      `${input.countryCode}:${input.bankCode}`,
    );
    if (!provider) {
      return { kind: 'unavailable', reason: 'banco_no_soportado' };
    }
    return provider.fetchBalance(input);
  }
}
