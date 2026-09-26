import { useSession } from "@/core/auth/session";
import { DashboardScreen } from "@/features/dashboard/screens/dashboard-screen";
import { CollectorHomeScreen } from "@/features/remittances/screens/collector-home-screen";

// Ruta raíz del flujo autenticado ("/"): el panel de bienvenida es lo primero que se ve al
// abrir la app y tras iniciar sesión. La Cartera vive ahora en "/cartera". El COBRADOR ve su
// propio inicio (su caja y su ruta): el panel de KPIs trae cifras de toda la empresa.
export default function HomeRoute() {
  const { role } = useSession();
  return role === "COLLECTOR" ? <CollectorHomeScreen /> : <DashboardScreen />;
}
