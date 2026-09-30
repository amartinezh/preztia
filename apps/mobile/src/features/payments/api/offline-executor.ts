import { api, tenantHeader, unwrap } from "@/core/api/client";
import { withRequestOptions } from "@/core/api/request-context";
import { registerExecutor } from "@/core/offline/queue";
import { queryClient } from "@/core/query";
import { creditKeys } from "@/features/credit/api/queries";
import { CASH_PAYMENT_KIND, paymentKeys, type CashPaymentPayload } from "./queries";

/**
 * Conecta la cola offline con el endpoint de abono. Al reenviar usa la `Idempotency-Key`
 * persistida en la operación encolada, por lo que el backend deduplica si el primer intento
 * sí llegó. Se invoca una vez al iniciar la app (efecto de arranque).
 *
 * El cobro se capturó sin señal: viaja la hora REAL de captura (`capturedAt` = cuando se encoló),
 * para que la fecha del pago sea la del cobro y no la de la sincronización. Fuera de la ventana
 * permitida el servidor lo registra con la hora actual (nunca lo rechaza por la fecha).
 */
export function registerCashPaymentExecutor() {
  registerExecutor(CASH_PAYMENT_KIND, async (op) => {
    const { creditId, amountMinor, paidOn } = op.payload as CashPaymentPayload;
    unwrap(
      await withRequestOptions({ idempotencyKey: op.idempotencyKey }, () =>
        api.registerCashPayment({
          headers: tenantHeader(),
          params: { creditId },
          // Una fecha elegida a mano manda sobre la hora de captura (son excluyentes).
          body: { amountMinor, ...(paidOn ? { paidOn } : { capturedAt: op.createdAt }) },
        }),
      ),
    );
    void queryClient.invalidateQueries({ queryKey: paymentKeys.list(creditId) });
    void queryClient.invalidateQueries({ queryKey: creditKeys.portfolio(creditId) });
  });
}
