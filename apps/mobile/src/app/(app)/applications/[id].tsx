import { useLocalSearchParams } from "expo-router";

import { ApplicationReviewDetailScreen } from "@/features/applications-review/screens/application-review-detail-screen";

export default function ApplicationReviewDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ApplicationReviewDetailScreen applicationId={id} />;
}
