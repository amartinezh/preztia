import { useLocalSearchParams } from "expo-router";

import { PaymentDetailScreen } from "@/features/payments/screens/payment-detail-screen";

export default function PaymentDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PaymentDetailScreen paymentId={id} />;
}
