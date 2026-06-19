import { useMemo, useState } from "react";
import { Pressable } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { PaymentSummary } from "@preztiaos/contracts";
import { Badge, Banner, Button, Card, EmptyState, MoneyText, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";
import { isApiError } from "@/core/errors";
import { useT, type MessageKey } from "@/core/i18n";
import { paymentBadge } from "../components/payment-status";
import {
  usePaymentAttempts,
  useReconcilePayments,
  type PaymentAttemptsParams,
} from "../api/queries";

// Filtros de la lista de intentos de pago (segmento superior).
type AttemptFilter = "ALL" | "VERIFIED" | "FAILED";
const FILTERS: { value: AttemptFilter; key: MessageKey; params: PaymentAttemptsParams }[] = [
  { value: "ALL", key: "payment.filter.all", params: {} },
  { value: "VERIFIED", key: "payment.filter.verified", params: { status: "VERIFIED" } },
  { value: "FAILED", key: "payment.filter.failed", params: { failedOnly: true } },
];

export function PaymentsHubScreen() {
  const { t } = useT();
  const router = useRouter();
  const { role } = useSession();
  const reconcile = useReconcilePayments();
  const [filter, setFilter] = useState<AttemptFilter>("ALL");
  const attempts = usePaymentAttempts(
    FILTERS.find((f) => f.value === filter)?.params ?? {},
  );
  const items = useMemo<PaymentSummary[]>(
    () => attempts.data?.pages.flatMap((p) => p.items) ?? [],
    [attempts.data],
  );
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

        {/* Intentos de pago (todos / verificados / fallidos): clic para el detalle/auditoría. */}
        <Stack gap="sm">
          <Text variant="heading">{t("payment.attempts.title")}</Text>
          <Row gap="sm" className="flex-wrap">
            {FILTERS.map((f) => {
              const active = filter === f.value;
              return (
                <Pressable
                  key={f.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setFilter(f.value)}
                  className={`min-h-[36px] justify-center rounded-full border px-3 ${
                    active
                      ? "border-brand-600 bg-brand-50 dark:bg-zinc-800"
                      : "border-zinc-200 dark:border-zinc-700"
                  }`}
                >
                  <Text variant="label" tone={active ? "primary" : "muted"}>
                    {t(f.key)}
                  </Text>
                </Pressable>
              );
            })}
          </Row>
          {attempts.isPending ? (
            <Spinner />
          ) : items.length === 0 ? (
            <EmptyState title={t("payment.attempts.empty")} />
          ) : (
            items.map((p) => {
              const badge = paymentBadge(p.status);
              return (
                <Pressable key={p.id} onPress={() => router.push(`/payments/${p.id}` as Href)}>
                  <Card>
                    <Row className="justify-between">
                      <Stack gap="xs">
                        <Text variant="label">{p.payerName ?? "—"}</Text>
                        <Text variant="caption" tone="muted">
                          {p.payerTaxIdMasked ?? p.payerBankName ?? p.endToEndId ?? p.id.slice(0, 8)}
                        </Text>
                      </Stack>
                      <Stack gap="xs" className="items-end">
                        {p.amountMinor !== null ? (
                          <MoneyText variant="label" amountMinor={p.amountMinor} currency={p.currency} />
                        ) : (
                          <Text variant="label" tone="muted">—</Text>
                        )}
                        <Badge tone={badge.tone} label={badge.label} />
                      </Stack>
                    </Row>
                  </Card>
                </Pressable>
              );
            })
          )}
          {attempts.hasNextPage ? (
            <Button
              label="Cargar más"
              variant="secondary"
              size="sm"
              loading={attempts.isFetchingNextPage}
              onPress={() => attempts.fetchNextPage()}
            />
          ) : null}
        </Stack>
      </Stack>
    </Screen>
  );
}
