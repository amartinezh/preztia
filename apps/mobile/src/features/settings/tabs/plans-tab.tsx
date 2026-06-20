import { useRouter, type Href } from "expo-router";
import { Card, ListItem, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";

/** Tab PLANES DE PAGO (solo ADMIN): acceso a la gestión de planes ofertables del tenant. */
export function PlansTab() {
  const { t } = useT();
  const router = useRouter();
  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">{t("plans.tab")}</Text>
        <ListItem
          title={t("plans.tab")}
          subtitle="Gestiona los planes de crédito ofertables"
          onPress={() => router.push("/payment-plans" as Href)}
          trailing={<Text tone="muted">›</Text>}
        />
      </Stack>
    </Card>
  );
}
