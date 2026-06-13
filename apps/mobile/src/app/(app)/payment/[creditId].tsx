import { useLocalSearchParams } from "expo-router";

import { RegisterPaymentScreen } from "@/features/payments/screens/register-payment-screen";

export default function RegisterPaymentRoute() {
  const { creditId } = useLocalSearchParams<{ creditId: string }>();
  return <RegisterPaymentScreen creditId={creditId} />;
}
