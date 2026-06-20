import { useRouter, type Href } from "expo-router";
import { Card, ListItem, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";

/**
 * Tab CUENTAS BANCARIAS (solo ADMIN): acceso a la configuración de caja/cuentas bancarias del
 * tenant. La pestaña NI SIQUIERA aparece para el Coordinador (RBAC a nivel de tab).
 */
export function BankAccountsTab() {
  const { t } = useT();
  const router = useRouter();
  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">Cuentas bancarias</Text>
        <ListItem
          title={t("cash.config.link")}
          subtitle="Cuentas bancarias y enrutado de pagos"
          onPress={() => router.push("/cash/config" as Href)}
          trailing={<Text tone="muted">›</Text>}
        />
        <ListItem
          title={t("cash.config.boxes")}
          subtitle="Cajas del tenant"
          onPress={() => router.push("/cash/boxes" as Href)}
          trailing={<Text tone="muted">›</Text>}
        />
      </Stack>
    </Card>
  );
}
