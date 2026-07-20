import { useLocalSearchParams } from "expo-router";

import { VisitDetailScreen } from "@/features/collections/screens/visit-detail-screen";

export default function VisitDetailRoute() {
  const { creditId } = useLocalSearchParams<{ creditId: string }>();
  return <VisitDetailScreen creditId={creditId} />;
}
