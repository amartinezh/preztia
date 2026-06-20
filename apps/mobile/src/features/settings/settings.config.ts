import type { ComponentType } from "react";

import type { SettingsSection } from "./hooks/use-permissions";
import { GeneralTab } from "./tabs/general-tab";
import { CollectionReminderTab } from "./tabs/collection-reminder-tab";
import { WhatsappTab } from "./tabs/whatsapp-tab";
import { PlansTab } from "./tabs/plans-tab";
import { BankAccountsTab } from "./tabs/bank-accounts-tab";
import { UsersTab } from "./tabs/users-tab";

/**
 * Definición DECLARATIVA de las pestañas de Ajustes. Añadir una sección es agregar una entrada
 * aquí (id RBAC + etiqueta + componente); el layout y los permisos se encargan del resto. Cada
 * componente de tab recibe `canEdit` para aplicar el bloqueo lectura/escritura de su contenido.
 */
export interface SettingsTabDef {
  readonly id: SettingsSection;
  readonly label: string;
  readonly Component: ComponentType<{ canEdit: boolean }>;
}

export const SETTINGS_TABS: readonly SettingsTabDef[] = [
  { id: "general", label: "General", Component: GeneralTab },
  { id: "collection", label: "Cobranza", Component: CollectionReminderTab },
  { id: "whatsapp", label: "WhatsApp / IA", Component: WhatsappTab },
  { id: "plans", label: "Planes", Component: PlansTab },
  { id: "bankAccounts", label: "Cuentas bancarias", Component: BankAccountsTab },
  { id: "users", label: "Usuarios", Component: UsersTab },
];
