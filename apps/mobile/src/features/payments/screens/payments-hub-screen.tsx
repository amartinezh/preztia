import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { BankStatusContract, PaymentSummary } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
  majorToMinor,
} from "@preztiaos/ui";

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

// Filtro rápido por estado (segmento superior, aplica al instante).
type AttemptFilter = "ALL" | "VERIFIED" | "FAILED";
const FILTERS: { value: AttemptFilter; key: MessageKey; params: PaymentAttemptsParams }[] = [
  { value: "ALL", key: "payment.filter.all", params: {} },
  { value: "VERIFIED", key: "payment.filter.verified", params: { status: "VERIFIED" } },
  { value: "FAILED", key: "payment.filter.failed", params: { failedOnly: true } },
];

// Opciones del filtro de verificación bancaria (chips). "ANY" = sin filtro.
type BankFilter = BankStatusContract | "ANY";
const BANK_FILTERS: { value: BankFilter; key: MessageKey }[] = [
  { value: "ANY", key: "payment.filter.bankAny" },
  { value: "CONFIRMED", key: "payment.filter.bankConfirmed" },
  { value: "NOT_FOUND", key: "payment.filter.bankNotFound" },
  { value: "UNAVAILABLE", key: "payment.filter.bankUnavailable" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Borrador editable de los filtros avanzados (texto crudo de los inputs). */
interface AdvancedDraft {
  q: string;
  minAmount: string;
  maxAmount: string;
  fromDate: string;
  toDate: string;
  bank: BankFilter;
}

const EMPTY_DRAFT: AdvancedDraft = {
  q: "",
  minAmount: "",
  maxAmount: "",
  fromDate: "",
  toDate: "",
  bank: "ANY",
};

export function PaymentsHubScreen() {
  const { t } = useT();
  const router = useRouter();
  const { role } = useSession();
  const reconcile = useReconcilePayments();

  const [filter, setFilter] = useState<AttemptFilter>("ALL");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draft, setDraft] = useState<AdvancedDraft>(EMPTY_DRAFT);
  // Filtros avanzados YA aplicados (lo que consume la consulta).
  const [advanced, setAdvanced] = useState<PaymentAttemptsParams>({});
  const [filterError, setFilterError] = useState<string | null>(null);

  const quickParams = useMemo(
    () => FILTERS.find((f) => f.value === filter)?.params ?? {},
    [filter],
  );
  const attempts = usePaymentAttempts({ ...advanced, ...quickParams });
  const items = useMemo<PaymentSummary[]>(
    () => attempts.data?.pages.flatMap((p) => p.items) ?? [],
    [attempts.data],
  );
  const total = attempts.data?.pages[0]?.total ?? 0;
  const activeCount = countActive(advanced);
  const [error, setError] = useState<string | null>(null);

  if (!can(role, "payment:reconcile")) {
    return (
      <Screen>
        <EmptyState title={t("payments.title")} description={t("errors.forbidden")} />
      </Screen>
    );
  }

  const applyAdvanced = () => {
    const built = buildAdvancedParams(draft);
    if ("error" in built) {
      setFilterError(t(built.error));
      return;
    }
    setFilterError(null);
    setAdvanced(built.params);
  };

  const clearAdvanced = () => {
    setDraft(EMPTY_DRAFT);
    setAdvanced({});
    setFilterError(null);
  };

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

        {/* Intentos de pago: filtro rápido por estado + filtros avanzados desplegables. */}
        <Stack gap="sm">
          <Row className="items-center justify-between">
            <Text variant="heading">{t("payment.attempts.title")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showAdvanced }}
              onPress={() => setShowAdvanced((v) => !v)}
              className="min-h-[36px] flex-row items-center gap-1 rounded-full border border-zinc-200 px-3 dark:border-zinc-700"
            >
              <Text variant="label" tone={activeCount > 0 ? "primary" : "muted"}>
                {t("payment.filter.advanced")}
                {activeCount > 0 ? ` (${activeCount})` : ""}
              </Text>
              <Text variant="label" tone="muted">{showAdvanced ? "▴" : "▾"}</Text>
            </Pressable>
          </Row>

          <Row gap="sm" className="flex-wrap">
            {FILTERS.map((f) => (
              <Chip
                key={f.value}
                label={t(f.key)}
                active={filter === f.value}
                onPress={() => setFilter(f.value)}
              />
            ))}
          </Row>

          {showAdvanced ? (
            <Card>
              <Stack gap="md">
                {filterError ? <Banner tone="danger" title={filterError} /> : null}

                <Field label={t("payment.filter.search")}>
                  <Input
                    value={draft.q}
                    onChangeText={(q) => setDraft((d) => ({ ...d, q }))}
                    autoCapitalize="none"
                    placeholder="—"
                    accessibilityLabel={t("payment.filter.search")}
                  />
                </Field>

                <Row gap="sm">
                  <View className="flex-1">
                    <Field label={t("payment.filter.minAmount")}>
                      <Input
                        keyboardType="numeric"
                        value={draft.minAmount}
                        onChangeText={(minAmount) => setDraft((d) => ({ ...d, minAmount }))}
                        placeholder="0"
                        accessibilityLabel={t("payment.filter.minAmount")}
                      />
                    </Field>
                  </View>
                  <View className="flex-1">
                    <Field label={t("payment.filter.maxAmount")}>
                      <Input
                        keyboardType="numeric"
                        value={draft.maxAmount}
                        onChangeText={(maxAmount) => setDraft((d) => ({ ...d, maxAmount }))}
                        placeholder="—"
                        accessibilityLabel={t("payment.filter.maxAmount")}
                      />
                    </Field>
                  </View>
                </Row>

                <Row gap="sm">
                  <View className="flex-1">
                    <Field label={t("payment.filter.fromDate")} hint={t("payment.filter.dateHint")}>
                      <Input
                        autoCapitalize="none"
                        value={draft.fromDate}
                        onChangeText={(fromDate) => setDraft((d) => ({ ...d, fromDate }))}
                        placeholder="AAAA-MM-DD"
                        accessibilityLabel={t("payment.filter.fromDate")}
                      />
                    </Field>
                  </View>
                  <View className="flex-1">
                    <Field label={t("payment.filter.toDate")} hint={t("payment.filter.dateHint")}>
                      <Input
                        autoCapitalize="none"
                        value={draft.toDate}
                        onChangeText={(toDate) => setDraft((d) => ({ ...d, toDate }))}
                        placeholder="AAAA-MM-DD"
                        accessibilityLabel={t("payment.filter.toDate")}
                      />
                    </Field>
                  </View>
                </Row>

                <Field label={t("payment.filter.bankStatus")}>
                  <Row gap="sm" className="flex-wrap">
                    {BANK_FILTERS.map((b) => (
                      <Chip
                        key={b.value}
                        label={t(b.key)}
                        active={draft.bank === b.value}
                        onPress={() => setDraft((d) => ({ ...d, bank: b.value }))}
                      />
                    ))}
                  </Row>
                </Field>

                <Row gap="sm">
                  <View className="flex-1">
                    <Button label={t("payment.filter.apply")} size="sm" block onPress={applyAdvanced} />
                  </View>
                  <View className="flex-1">
                    <Button
                      label={t("payment.filter.clear")}
                      variant="secondary"
                      size="sm"
                      block
                      onPress={clearAdvanced}
                    />
                  </View>
                </Row>
              </Stack>
            </Card>
          ) : null}

          {attempts.isPending ? (
            <Spinner />
          ) : items.length === 0 ? (
            <EmptyState title={t("payment.attempts.empty")} />
          ) : (
            <>
              <Text variant="caption" tone="muted">
                {total} {t("payment.filter.results")}
              </Text>
              {items.map((p) => {
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
              })}
            </>
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

/** Chip de filtro reutilizable (estado y banco): pill con estado activo/inactivo. */
function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={`min-h-[36px] justify-center rounded-full border px-3 ${
        active
          ? "border-brand-600 bg-brand-50 dark:bg-zinc-800"
          : "border-zinc-200 dark:border-zinc-700"
      }`}
    >
      <Text variant="label" tone={active ? "primary" : "muted"}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Cuenta los filtros avanzados activos (para el contador del botón). */
function countActive(params: PaymentAttemptsParams): number {
  return [
    params.q,
    params.bankStatus,
    params.minAmountMinor,
    params.maxAmountMinor,
    params.fromDate,
    params.toDate,
  ].filter((v) => v !== undefined).length;
}

type BuildResult = { params: PaymentAttemptsParams } | { error: MessageKey };

/**
 * Traduce el borrador de inputs a parámetros de consulta validados. Los montos van en
 * unidades mayores → menores; las fechas se validan contra AAAA-MM-DD. Falla rápido ante
 * entradas inválidas para no enviar una consulta incoherente al servidor.
 */
function buildAdvancedParams(draft: AdvancedDraft): BuildResult {
  const params: PaymentAttemptsParams = {};

  const q = draft.q.trim();
  if (q) params.q = q;

  if (draft.bank !== "ANY") params.bankStatus = draft.bank;

  const min = draft.minAmount.trim();
  if (min) {
    const n = Number(min);
    if (!Number.isFinite(n) || n < 0) return { error: "errors.validation" };
    params.minAmountMinor = majorToMinor(n);
  }
  const max = draft.maxAmount.trim();
  if (max) {
    const n = Number(max);
    if (!Number.isFinite(n) || n < 0) return { error: "errors.validation" };
    params.maxAmountMinor = majorToMinor(n);
  }
  if (
    params.minAmountMinor !== undefined &&
    params.maxAmountMinor !== undefined &&
    params.minAmountMinor > params.maxAmountMinor
  ) {
    return { error: "payment.filter.invalidRange" };
  }

  const from = draft.fromDate.trim();
  if (from) {
    if (!DATE_RE.test(from)) return { error: "payment.filter.invalidDate" };
    params.fromDate = from;
  }
  const to = draft.toDate.trim();
  if (to) {
    if (!DATE_RE.test(to)) return { error: "payment.filter.invalidDate" };
    params.toDate = to;
  }

  return { params };
}
