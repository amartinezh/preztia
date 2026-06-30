import { Injectable, Logger } from '@nestjs/common';
import { isEligiblePixCredit, type NormalizedCredit } from '@preztiaos/domain';
import {
  type SettlementSource,
  type SettlementWindow,
} from '@preztiaos/application';
import { parseSettlementCsv } from './mp-report-csv.parser';
import { type SettlementReportFetcher } from './mp-report.client';
import { type MercadoPagoContextReader } from './mp-account-context.reader';

/**
 * Adaptador `SettlementSource` de Mercado Pago: resuelve el access_token de la cuenta, trae el
 * CSV del settlement_report, lo parsea y devuelve SOLO los ingresos PIX reales (filtro de
 * dominio `isEligiblePixCredit`: bank_transfer, neto > 0, sin REFUND/CHARGEBACK). Cualquier
 * fallo degrada a lista vacía — la conciliación queda sin confirmar, nunca rompe ni libera.
 */
@Injectable()
export class MercadoPagoSettlementAdapter implements SettlementSource {
  private readonly logger = new Logger('Payments:MercadoPagoSettlement');

  constructor(
    private readonly reader: MercadoPagoContextReader,
    private readonly fetcher: SettlementReportFetcher,
  ) {}

  async fetchCredits(
    window: SettlementWindow,
  ): Promise<readonly NormalizedCredit[]> {
    try {
      const context = await this.reader.read({
        tenantId: window.tenantId,
        countryCode: window.countryCode,
        bankCode: window.bankCode,
      });
      if (!context) return [];

      const csv = await this.fetcher.fetchSettlementCsv({
        accessToken: context.accessToken,
        begin: window.begin,
        end: window.end,
        reportConfig: context.reportConfig,
      });
      if (!csv) return [];

      return parseSettlementCsv(csv, { defaultCurrency: 'BRL' }).filter(
        isEligiblePixCredit,
      );
    } catch (err) {
      this.logger.error(
        'Fallo obteniendo créditos de Mercado Pago; conciliación sin confirmar',
        err instanceof Error ? err.stack : String(err),
      );
      return [];
    }
  }
}
