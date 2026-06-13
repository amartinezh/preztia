import { Button, Card, Row, Stack, Text } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { useT } from "@/core/i18n";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  COORDINATOR: "Coordinador",
  COLLECTOR: "Cobrador",
};

export function SettingsScreen() {
  const { t } = useT();
  const { claims, role, signOut } = useSession();

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">Ajustes</Text>

        <Card>
          <Stack gap="sm">
            <Row className="justify-between">
              <Text tone="muted">Rol</Text>
              <Text variant="label">{role ? ROLE_LABEL[role] : "—"}</Text>
            </Row>
            <Row className="justify-between">
              <Text tone="muted">Tenant</Text>
              <Text variant="code">{claims?.tenantId.slice(0, 8) ?? "—"}</Text>
            </Row>
            <Row className="justify-between">
              <Text tone="muted">Zonas</Text>
              <Text variant="label">{claims?.zonePaths.length ?? 0}</Text>
            </Row>
          </Stack>
        </Card>

        <Button label={t("auth.signOut")} variant="secondary" onPress={() => void signOut()} />
      </Stack>
    </Screen>
  );
}
