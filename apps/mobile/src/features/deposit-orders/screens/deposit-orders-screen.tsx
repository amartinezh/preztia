import { Stack } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { DepositOrdersPanel } from "../components/deposit-orders-panel";

/** Segmento "Consignaciones" de Dinero: órdenes de la zona del revisor, para verificar u objetar. */
export function DepositOrdersScreen() {
  return (
    <Screen>
      <Stack gap="lg">
        <DepositOrdersPanel mode="review" />
      </Stack>
    </Screen>
  );
}
