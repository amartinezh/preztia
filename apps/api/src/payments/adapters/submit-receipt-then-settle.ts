import { Logger } from '@nestjs/common';
import {
  SubmitPaymentReceiptHandler,
  type SubmitPaymentReceiptCommand,
} from '@preztiaos/application';
import { RunSettlementReconciliationService } from '../run-settlement-reconciliation.service';

/**
 * Decorador de infraestructura del caso de uso de comprobantes: tras registrar el comprobante,
 * dispara la conciliación de settlement con lo YA ingerido (`refresh: false`, sin golpear las
 * APIs de los proveedores). Cubre el orden habitual de PicPay: el webhook PAID llega ANTES que
 * la captura de WhatsApp → el comprobante recién registrado se confirma al instante contra el
 * crédito real (match por E2E o monto único). Best-effort: un fallo de la conciliación no
 * afecta la recepción del comprobante (el ciclo por endpoint/cron la recupera).
 */
export class SubmitReceiptThenSettleHandler extends SubmitPaymentReceiptHandler {
  private readonly settleLogger = new Logger(
    'Payments:SubmitReceiptThenSettle',
  );

  constructor(
    deps: ConstructorParameters<typeof SubmitPaymentReceiptHandler>,
    private readonly settle: RunSettlementReconciliationService,
  ) {
    super(...deps);
  }

  override async execute(cmd: SubmitPaymentReceiptCommand): Promise<void> {
    await super.execute(cmd);
    try {
      await this.settle.execute({ tenantId: cmd.tenantId, refresh: false });
    } catch (err) {
      this.settleLogger.warn(
        `Conciliación post-comprobante fallida (se recupera por ciclo): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
