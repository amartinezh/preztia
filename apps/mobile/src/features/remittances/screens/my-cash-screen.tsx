import { useState } from "react";
import { submitRemittanceInput } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  majorToMinor,
  minorToMajor,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { ExpenseRequestForm } from "@/features/cash/components/expenses/expense-request-form";
import { ExpensesPanel } from "@/features/cash/components/expenses/expenses-panel";
import { useMyRemittance, useMyRemittanceHistory, useSubmitRemittance } from "../api/queries";
import {
  ObligationBadge,
  RemittanceHistoryItem,
  RemittanceSummaryCard,
} from "../components/remittance-parts";

/**
 * "Mi caja" del COBRADOR: el efectivo en su poder, lo que va desde su último corte ("recogí X,
 * gasté Y, entrego Z"), su obligación de rendir (con la hora límite o el atraso), la declaración
 * de lo que entrega, sus solicitudes de gasto (con comprobante) y TODO su historial de rendiciones
 * y gastos (para aclarar cuadres y malentendidos).
 */
export function MyCashScreen() {
  const { t } = useT();
  const mine = useMyRemittance();

  if (mine.isPending) return <Spinner label={t("common.loading")} />;
  if (mine.isError || !mine.data) {
    return <ErrorState title={t("errors.unknown")} onRetry={() => void mine.refetch()} />;
  }
  const data = mine.data;

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("remittance.mine.title")}</Text>

        {!data.hasRouteBox ? (
          <Banner tone="warning" title={t("payments.noRouteBox")} />
        ) : (
          <>
            <Card>
              <Stack gap="sm">
                <ObligationBadge status={data.status} lateMinutes={data.lateMinutes} dueAt={data.dueAt} />
                <Row className="items-center justify-between">
                  <Text variant="label">{t("remittance.cashInHand")}</Text>
                  <MoneyText variant="heading" amountMinor={data.cashInHandMinor} currency={data.currency} />
                </Row>
                {data.carriedDebtMinor > 0 ? (
                  <Row className="items-center justify-between">
                    <Text variant="label" tone="danger">
                      {t("remittance.carriedDebt")}
                    </Text>
                    <MoneyText variant="label" amountMinor={data.carriedDebtMinor} currency={data.currency} />
                  </Row>
                ) : null}
                <Text variant="caption" tone="muted">
                  {t("remittance.deadlineHint").replace("{hour}", `${data.deadlineHourLocal}:00`)}
                </Text>
              </Stack>
            </Card>

            <Text variant="heading">{t("remittance.sinceLastCut")}</Text>
            <RemittanceSummaryCard summary={data.summary} currency={data.currency} />

            {data.openRemittance ? (
              <Banner
                tone="info"
                title={t("remittance.awaiting")}
                description={`${t("remittance.declared")}: ${minorToMajor(data.openRemittance.declaredMinor)} ${data.currency}`}
              />
            ) : (
              <SubmitForm
                expectedMinor={data.summary.expectedMinor}
                canSubmit={data.status !== "UP_TO_DATE" || data.cashInHandMinor > 0}
              />
            )}
          </>
        )}

        <Text variant="heading">{t("cash.expenses.mineTitle")}</Text>
        <ExpenseRequestForm />
        <ExpensesPanel mode="mine" currency={data.currency} />

        <Text variant="heading">{t("remittance.history")}</Text>
        <MyHistory currency={data.currency} />
      </Stack>
    </Screen>
  );
}

/** Declaración de lo que entrega; se prellena con lo esperado según el libro. */
function SubmitForm({ expectedMinor, canSubmit }: { expectedMinor: number; canSubmit: boolean }) {
  const { t } = useT();
  const submit = useSubmitRemittance();
  const [amount, setAmount] = useState(String(minorToMajor(expectedMinor)));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = () => {
    setError(null);
    const parsed = submitRemittanceInput.safeParse({
      declaredMinor: majorToMinor(Number(amount) || 0),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("errors.validation"));
      return;
    }
    submit.mutate(parsed.data, {
      onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="label">{t("remittance.submit.title")}</Text>
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("remittance.submit.amount")} hint={t("remittance.submit.amountHint")} required>
          <Input keyboardType="numeric" value={amount} onChangeText={setAmount} />
        </Field>
        <Field label={t("remittance.submit.note")}>
          <Input value={note} onChangeText={setNote} multiline />
        </Field>
        <Button
          label={t("remittance.submit.action")}
          loading={submit.isPending}
          disabled={!canSubmit}
          block
          onPress={onSubmit}
        />
        {!canSubmit ? (
          <Text variant="caption" tone="muted">
            {t("remittance.submit.nothing")}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

function MyHistory({ currency }: { currency: string }) {
  const { t } = useT();
  const history = useMyRemittanceHistory();
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];

  if (history.isPending) return <Spinner label={t("common.loading")} />;
  if (items.length === 0) return <Text tone="muted">{t("remittance.historyEmpty")}</Text>;
  return (
    <Stack gap="sm">
      {items.map((r) => (
        <RemittanceHistoryItem key={r.id} remittance={r} currency={currency} />
      ))}
      {history.hasNextPage ? (
        <Button
          label={t("common.loadMore")}
          variant="ghost"
          loading={history.isFetchingNextPage}
          onPress={() => void history.fetchNextPage()}
        />
      ) : null}
    </Stack>
  );
}
