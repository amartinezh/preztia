import { useRouter, type Href } from "expo-router";
import { Card, ListItem, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";

/**
 * Tab ZONAS (solo quien administra zonas): acceso al árbol de zonas del tenant, donde cada zona
 * configura sus canales (número de WhatsApp, bot de Telegram y teléfono de atención).
 */
export function ZonesTab() {
  const { t } = useT();
  const router = useRouter();
  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">{t("zones.tab")}</Text>
        <ListItem
          title={t("zones.tab")}
          subtitle="Árbol de zonas, alcance y canales (WhatsApp / Telegram) de cada zona"
          onPress={() => router.push("/zones" as Href)}
          trailing={<Text tone="muted">›</Text>}
        />
      </Stack>
    </Card>
  );
}
