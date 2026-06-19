import { useState } from "react";
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
  useCloseSettlement,
  useCreateExpense,
  useDailyReport,
  useExpensesList,
  useReviewExpense,
  useSettlementPreview,
  useSettlementsList,
} from "../api/queries";

const EXPENSE_TONE: Record<Expense["status"], BadgeTone> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

/** Caja: reporte diario, liquidada (cierre encadenado) y gastos (maker-checker). */
export function CashScreen() {
  const { t } = useT();
  const router = useRouter();
  const { role } = useSession();
  const manages = can(role, "cash:manage");

  return (
    <Screen>
      <Stack gap="lg">
        <Row className="justify-between items-center">
          <Text variant="subtitle">{t("cash.title")}</Text>
          <Button
            label={t("cash.boxes.link")}
            variant="secondary"
            size="sm"
            onPress={() => router.push("/cash/boxes" as Href)}
          />
        </Row>
        <DailyReportCard />
        <SettlementSection canManage={manages} />
        <ExpensesSection canManage={manages} />
      </Stack>
    </Screen>
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

function SettlementSection({ canManage }: { canManage: boolean }) {
  const { t } = useT();
  const preview = useSettlementPreview();
  const history = useSettlementsList();
  const close = useCloseSettlement();
  const [error, setError] = useState<string | null>(null);

  const onClose = () => {
    setError(null);
    close.mutate(undefined, {
      onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <Stack gap="sm">
      <Text variant="heading">{t("cash.settlement.title")}</Text>
      {error ? <Banner tone="danger" title={error} /> : null}
      {canManage && preview.data ? (
        <Card>
          <Stack gap="xs">
            <Line label={t("cash.field.previousCash")} amountMinor={preview.data.cajaAnteriorMinor} currency={preview.data.currency} />
            <Line label={t("cash.field.collected")} amountMinor={preview.data.totalCobradoMinor} currency={preview.data.currency} />
            <Line label={t("cash.field.lent")} amountMinor={preview.data.totalPrestadoMinor} currency={preview.data.currency} />
            <Line label={t("cash.field.expenses")} amountMinor={preview.data.gastosMinor} currency={preview.data.currency} />
            <Line label={t("cash.field.currentCash")} amountMinor={preview.data.cajaActualMinor} currency={preview.data.currency} />
            <Button label={t("cash.settlement.close")} loading={close.isPending} block onPress={onClose} />
          </Stack>
        </Card>
      ) : null}
      <Text variant="label" tone="muted">{t("cash.settlement.history")}</Text>
      {history.data?.items.length ? (
        history.data.items.map((s) => (
          <ListItem
            key={s.id}
            title={new Date(s.createdAt).toLocaleDateString()}
            subtitle={`${t("cash.field.currentCash")}`}
            trailing={<MoneyText variant="body" amountMinor={s.cajaActualMinor} currency={"COP"} />}
          />
        ))
      ) : (
        <Text tone="muted">{t("cash.settlement.empty")}</Text>
      )}
    </Stack>
  );
}

function ExpensesSection({ canManage }: { canManage: boolean }) {
  const { t } = useT();
  const list = useExpensesList();
  const create = useCreateExpense();
  const review = useReviewExpense();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
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
      {list.data?.items.map((e) => (
        <ListItem
          key={e.id}
          title={e.description}
          subtitle={t(`cash.status.${e.status}` as Parameters<typeof t>[0])}
          trailing={
            <Row className="items-center gap-2">
              <MoneyText variant="body" amountMinor={e.amountMinor} currency={"COP"} />
              {canManage && e.status === "PENDING" ? (
                <>
                  <Button label={t("cash.expenses.approve")} size="sm" onPress={() => review.mutate({ id: e.id, approve: true })} />
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
