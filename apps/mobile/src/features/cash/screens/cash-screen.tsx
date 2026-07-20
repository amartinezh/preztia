import { useState } from "react";
import { Pressable } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { Expense } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  Input,
  ListItem,
  majorToMinor,
  minorToMajor,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
  type BadgeTone,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import {
  useCreateExpense,
  useDailyReport,
  useExpensesList,
  useReviewExpense,
} from "../api/queries";
import { useCashDashboard } from "../api/boxes-queries";

const EXPENSE_TONE: Record<Expense["status"], BadgeTone> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

/**
 * Resumen de Dinero / Tesorería: el dinero real al frente (liquidez del libro de cajas), seguido
 * del reporte diario (P&L de cartera) y los gastos (maker-checker). El detalle por caja (saldos,
 * arqueo, conciliación, movimientos) vive en el segmento "Cajas y cuentas" del hub Dinero.
 *
 * `embedded`: dentro del hub Dinero el encabezado propio sobra (el hub ya da título + segmentos);
 * `onOpenBoxes` cambia al segmento de cajas en lugar de navegar a la ruta suelta.
 */
export function CashScreen({
  embedded = false,
  onOpenBoxes,
}: {
  embedded?: boolean;
  onOpenBoxes?: () => void;
} = {}) {
  const { t } = useT();
  const router = useRouter();
  const { role } = useSession();
  const manages = can(role, "cash:manage");
  const openBoxes = onOpenBoxes ?? (() => router.push("/cash/boxes" as Href));

  return (
    <Screen>
      <Stack gap="lg">
        {embedded ? null : (
          <Row className="justify-between items-center">
            <Text variant="subtitle">{t("cash.title")}</Text>
            <Button label={t("cash.boxes.link")} variant="secondary" size="sm" onPress={openBoxes} />
          </Row>
        )}
        <TreasurySummaryCard onOpenBoxes={openBoxes} />
        <DailyReportCard />
        <ExpensesSection canManage={manages} />
      </Stack>
    </Screen>
  );
}

/**
 * Resumen de tesorería (fuente única = libro de cajas): liquidez total, efectivo y banco, y la
 * alerta de dinero en tránsito. Toca "Ver detalle" para ir a las cajas (arqueo, conciliación).
 */
function TreasurySummaryCard({ onOpenBoxes }: { onOpenBoxes: () => void }) {
  const { t } = useT();
  const query = useCashDashboard();
  if (query.isPending) return <Spinner label={t("common.loading")} />;
  if (query.isError || !query.data) return <Banner tone="danger" title={t("errors.network")} />;
  const d = query.data;
  return (
    <Stack gap="sm">
      <Text variant="heading">{t("cash.treasury.title")}</Text>
      <Card>
        <Stack gap="sm">
          <Stack gap="xs">
            <Text tone="muted">{t("cash.boxes.liquidity")}</Text>
            <MoneyText variant="heading" amountMinor={d.liquidityTotalMinor} currency={d.currency} />
          </Stack>
          <Line label={t("cash.boxes.cashCustody")} amountMinor={d.cashTotalMinor} currency={d.currency} />
          <Line label={t("cash.boxes.bankTotal")} amountMinor={d.bankTotalMinor} currency={d.currency} />
          {d.unidentifiedMinor > 0 ? (
            <Banner
              tone="warning"
              title={t("cash.boxes.unidentified")}
              description={`${minorToMajor(d.unidentifiedMinor)} ${d.currency}`}
            />
          ) : null}
          <Button label={t("cash.treasury.detail")} variant="secondary" size="sm" block onPress={onOpenBoxes} />
        </Stack>
      </Card>
    </Stack>
  );
}

function Line({ label, amountMinor, currency }: { label: string; amountMinor: number; currency: string }) {
  return (
    <Row className="justify-between">
      <Text tone="muted">{label}</Text>
      <MoneyText variant="label" amountMinor={amountMinor} currency={currency} />
    </Row>
  );
}

function DailyReportCard() {
  const { t } = useT();
  const query = useDailyReport();
  if (query.isPending) return <Spinner label={t("common.loading")} />;
  if (query.isError || !query.data) return <Banner tone="danger" title={t("errors.network")} />;
  const r = query.data;
  return (
    <Card>
      <Stack gap="xs">
        <Text variant="heading">{t("cash.daily.title")}</Text>
        <Line label={t("cash.field.collected")} amountMinor={r.totalCobradoMinor} currency={r.currency} />
        <Line label={t("cash.field.lent")} amountMinor={r.totalPrestadoMinor} currency={r.currency} />
        <Line label={t("cash.field.expenses")} amountMinor={r.gastosMinor} currency={r.currency} />
        <Line label={t("cash.field.cashOfDay")} amountMinor={r.cajaDelDiaMinor} currency={r.currency} />
        <Row className="justify-between">
          <Text tone="muted">{t("cash.daily.clients")}</Text>
          <Text variant="label">{r.clientsWithPayments}</Text>
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("cash.daily.pendingExpenses")}</Text>
          <Text variant="label">{r.pendingExpenses}</Text>
        </Row>
      </Stack>
    </Card>
  );
}

function ExpensesSection({ canManage }: { canManage: boolean }) {
  const { t } = useT();
  const list = useExpensesList();
  const create = useCreateExpense();
  const review = useReviewExpense();
  // Aprobar un gasto lo paga desde una caja/cuenta (asiento EXPENSE OUT): saldos desde el dashboard.
  const dashboard = useCashDashboard();
  const fundableBoxes = (dashboard.data?.boxes ?? []).filter((b) => b.type !== "TRANSIT");
  const currency = dashboard.data?.currency ?? "BRL";
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidFromCashBoxId, setPaidFromCashBoxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const amountMinor = majorToMinor(Number(amount) || 0);
    if (!description.trim() || amountMinor <= 0) {
      setError(t("errors.validation"));
      return;
    }
    create.mutate(
      { description: description.trim(), amountMinor },
      {
        onSuccess: () => {
          setDescription("");
          setAmount("");
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  const hasPending = canManage && (list.data?.items.some((e) => e.status === "PENDING") ?? false);

  return (
    <Stack gap="sm">
      <Text variant="heading">{t("cash.expenses.title")}</Text>
      {error ? <Banner tone="danger" title={error} /> : null}
      <Card>
        <Stack gap="sm">
          <Field label={t("cash.expenses.description")} required>
            <Input value={description} onChangeText={setDescription} />
          </Field>
          <Field label={t("cash.expenses.amount")} required>
            <Input value={amount} onChangeText={setAmount} keyboardType="numeric" />
          </Field>
          <Button label={t("cash.expenses.request")} loading={create.isPending} block onPress={submit} />
        </Stack>
      </Card>

      {/* Caja/cuenta pagadora: al aprobar, el gasto la debita (EXPENSE OUT). */}
      {hasPending ? (
        <Field label={t("cash.expenses.paidFrom")} hint={t("cash.expenses.paidFromHint")}>
          {dashboard.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : fundableBoxes.length === 0 ? (
            <Banner tone="warning" title={t("cash.expenses.paidFromEmpty")} />
          ) : (
            <Stack gap="xs">
              {fundableBoxes.map((b) => {
                const isSelected = b.id === paidFromCashBoxId;
                return (
                  <Pressable
                    key={b.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => setPaidFromCashBoxId(b.id)}
                    className={`min-h-[48px] flex-row items-center justify-between rounded-xl border px-3 ${
                      isSelected
                        ? "border-brand-600 bg-brand-50 dark:bg-zinc-800"
                        : "border-zinc-200 dark:border-zinc-700"
                    }`}
                  >
                    <Text variant="label" tone={isSelected ? "primary" : "muted"}>
                      {b.name}
                    </Text>
                    <MoneyText variant="label" amountMinor={b.balanceMinor} currency={b.currency} />
                  </Pressable>
                );
              })}
            </Stack>
          )}
        </Field>
      ) : null}

      {list.data?.items.map((e) => (
        <ListItem
          key={e.id}
          title={e.description}
          subtitle={t(`cash.status.${e.status}` as Parameters<typeof t>[0])}
          trailing={
            <Row className="items-center gap-2">
              <MoneyText variant="body" amountMinor={e.amountMinor} currency={currency} />
              {canManage && e.status === "PENDING" ? (
                <>
                  <Button
                    label={t("cash.expenses.approve")}
                    size="sm"
                    disabled={!paidFromCashBoxId}
                    onPress={() =>
                      paidFromCashBoxId &&
                      review.mutate({ id: e.id, approve: true, paidFromCashBoxId })
                    }
                  />
                  <Button label={t("cash.expenses.reject")} variant="ghost" size="sm" onPress={() => review.mutate({ id: e.id, approve: false })} />
                </>
              ) : (
                <Badge label={t(`cash.status.${e.status}` as Parameters<typeof t>[0])} tone={EXPENSE_TONE[e.status]} />
              )}
            </Row>
          }
        />
      ))}
    </Stack>
  );
}
