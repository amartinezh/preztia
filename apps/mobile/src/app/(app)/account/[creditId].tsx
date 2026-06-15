import { useLocalSearchParams } from "expo-router";

import { AccountDetailScreen } from "@/features/accounts/screens/account-detail-screen";

export default function AccountDetailRoute() {
  const { creditId } = useLocalSearchParams<{ creditId: string }>();
  return <AccountDetailScreen creditId={creditId} />;
}
