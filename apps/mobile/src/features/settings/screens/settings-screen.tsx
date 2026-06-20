import { SettingsLayout } from "../components/settings-layout";

/**
 * Pantalla de Ajustes: delega en `SettingsLayout`, que organiza la configuración en pestañas por
 * dominio (General, Cobranza, WhatsApp/IA, Planes, Cuentas bancarias, Usuarios), aplica RBAC por
 * rol (qué pestañas se ven y si se pueden editar) y persiste la pestaña activa en la URL.
 */
export function SettingsScreen() {
  return <SettingsLayout />;
}
