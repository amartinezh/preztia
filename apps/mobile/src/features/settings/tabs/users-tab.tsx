import { useRouter, type Href } from "expo-router";
import { Card, ListItem, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";

/** Tab USUARIOS (solo ADMIN): administración de los usuarios del tenant. Las zonas tienen su propio tab. */
export function UsersTab() {
  const { t } = useT();
  const router = useRouter();
  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">{t("users.tab")}</Text>
        <ListItem
          title={t("users.tab")}
          subtitle="Crear y administrar usuarios del tenant"
          onPress={() => router.push("/users" as Href)}
          trailing={<Text tone="muted">›</Text>}
        />
      </Stack>
    </Card>
  );
}
