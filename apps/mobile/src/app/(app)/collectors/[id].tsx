import { useLocalSearchParams } from "expo-router";
import { AssignClientsScreen } from "@/features/collectors/screens/assign-clients-screen";

export default function AssignClientsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <AssignClientsScreen collectorId={id} />;
}
