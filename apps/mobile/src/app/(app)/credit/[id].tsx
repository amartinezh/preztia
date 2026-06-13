import { useLocalSearchParams } from "expo-router";

import { CreditPortfolioScreen } from "@/features/credit/screens/credit-portfolio-screen";

export default function CreditDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CreditPortfolioScreen creditId={id} />;
}
