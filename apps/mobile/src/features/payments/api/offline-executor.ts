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
 */
export function registerCashPaymentExecutor() {
  registerExecutor(CASH_PAYMENT_KIND, async (op) => {
    const { creditId, amountMinor } = op.payload as CashPaymentPayload;
    unwrap(
      await withRequestOptions({ idempotencyKey: op.idempotencyKey }, () =>
        api.registerCashPayment({
          headers: tenantHeader(),
          params: { creditId },
          body: { amountMinor },
        }),
      ),
    );
    void queryClient.invalidateQueries({ queryKey: paymentKeys.list(creditId) });
    void queryClient.invalidateQueries({ queryKey: creditKeys.portfolio(creditId) });
  });
}
