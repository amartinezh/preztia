import { useLocalSearchParams } from "expo-router";

import { AccountDetailScreen } from "@/features/accounts/screens/account-detail-screen";

/**
 * Un solo detalle de crédito: la misma pantalla que `/account/[creditId]`. `granted=1` llega al
 * venir de otorgar/aprobar y dispara el aviso "Crédito otorgado · cuota $X".
 */
export default function CreditDetailRoute() {
  const { id, granted } = useLocalSearchParams<{ id: string; granted?: string }>();
  return <AccountDetailScreen creditId={id} justGranted={granted === "1"} />;
}
