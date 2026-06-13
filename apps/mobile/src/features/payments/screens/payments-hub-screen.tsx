import { useState } from "react";
import { Banner, Button, Card, EmptyState, Stack, Text } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useReconcilePayments } from "../api/queries";

export function PaymentsHubScreen() {
  const { t } = useT();
  const { role } = useSession();
  const reconcile = useReconcilePayments();
  const [error, setError] = useState<string | null>(null);

  if (!can(role, "payment:reconcile")) {
    return (
      <Screen>
        <EmptyState title={t("payments.title")} description={t("errors.forbidden")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("payments.title")}</Text>
        {error ? <Banner tone="danger" title={error} /> : null}
        {reconcile.isSuccess ? (
          <Card>
            <Stack gap="xs">
              <Text variant="label" tone="success">Conciliación completada</Text>
              <Text tone="muted">
                Procesados {reconcile.data.processed} · verificados {reconcile.data.verified} · pendientes{" "}
                {reconcile.data.stillPending} · marcados {reconcile.data.flagged}
              </Text>
            </Stack>
          </Card>
        ) : null}
        <Button
          label="Conciliar pagos pendientes"
          loading={reconcile.isPending}
          onPress={() =>
            reconcile.mutate(undefined, {
              onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
            })
          }
        />
      </Stack>
    </Screen>
  );
}
