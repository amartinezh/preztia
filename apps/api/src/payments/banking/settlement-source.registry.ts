import { Injectable } from '@nestjs/common';
import {
  type SettlementSource,
  type SettlementWindow,
} from '@preztiaos/application';
import { type NormalizedCredit } from '@preztiaos/domain';

/**
 * Registro de fuentes de liquidación por (país, entidad): implementa `SettlementSource`
 * resolviendo el adaptador con la clave "PAÍS:BANCO".
 *
 * PUNTO DE EXTENSIÓN: para conciliar un proveedor nuevo se crea su adaptador y se registra con
 * su clave (ej. "BR:MERCADOPAGO"); la aplicación no cambia. Una clave desconocida degrada a
 * lista vacía (la conciliación queda sin confirmar, no rompe).
 */
@Injectable()
export class SettlementSourceRegistry implements SettlementSource {
  constructor(
    private readonly sources: ReadonlyMap<string, SettlementSource>,
  ) {}

  async fetchCredits(
    window: SettlementWindow,
  ): Promise<readonly NormalizedCredit[]> {
    const source = this.sources.get(`${window.countryCode}:${window.bankCode}`);
    if (!source) return [];
    return source.fetchCredits(window);
  }
}
