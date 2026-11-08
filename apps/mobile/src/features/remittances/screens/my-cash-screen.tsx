import { useState } from "react";
import { submitRemittanceInput, type SubmitRemittanceInput } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Card,
  ConfirmModal,
  ErrorState,
  Field,
  formatMoney,
  Input,
  MoneyInput,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
  useToast,
} from "@preztiaos/ui";

import { moneyInputText } from "@/components/money-input-text";
import { Screen } from "@/components/screen";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { ExpenseRequestForm } from "@/features/cash/components/expenses/expense-request-form";
import { DepositOrdersPanel } from "@/features/deposit-orders/components/deposit-orders-panel";
import { ExpensesPanel } from "@/features/cash/components/expenses/expenses-panel";
import { useMyRemittance, useMyRemittanceHistory, useSubmitRemittance } from "../api/queries";
import { OfflineOperationsSection } from "../components/offline-operations-section";
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

  // Lo guardado sin señal se muestra SIEMPRE arriba, también cuando la caja no carga (sin red es
  // justo cuando hay pendientes): la persona nunca pierde de vista un abono que el servidor no tiene.
  if (mine.isPending || mine.isError || !mine.data) {
    return (
      <Screen>
        <Stack gap="lg">
          <OfflineOperationsSection currency={null} />
          {mine.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : (
            <ErrorState
              title={t("common.loadFailed")}
              description={t("common.loadFailedHint")}
              retryLabel={t("common.retry")}
              onRetry={() => void mine.refetch()}
            />
          )}
        </Stack>
      </Screen>
    );
  }
  const data = mine.data;

  return (
    <Screen>
      <Stack gap="lg">
        <OfflineOperationsSection currency={data.currency} />
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
                description={`${t("remittance.declared")}: ${formatMoney(data.openRemittance.declaredMinor, data.currency)}`}
              />
            ) : (
              <SubmitForm
                expectedMinor={data.summary.expectedMinor}
                canSubmit={data.status !== "UP_TO_DATE" || data.cashInHandMinor > 0}
                currency={data.currency}
              />
            )}
          </>
        )}

        <Text variant="heading">{t("deposit.title")}</Text>
        <DepositOrdersPanel mode="mine" />

        <Text variant="heading">{t("cash.expenses.mineTitle")}</Text>
        <ExpenseRequestForm currency={data.currency} />
        <ExpensesPanel mode="mine" currency={data.currency} />

        <Text variant="heading">{t("remittance.history")}</Text>
        <MyHistory currency={data.currency} />
      </Stack>
    </Screen>
  );
}

/**
 * Declaración de lo que entrega; se prellena con lo esperado según el libro. Antes de enviar se
 * confirma lo declarado frente a lo esperado (la rendición queda sellada) y al éxito se avisa con
 * un toast: el formulario desaparece y sin aviso parecería que no pasó nada.
 */
function SubmitForm({
  expectedMinor,
  canSubmit,
  currency,
}: {
  expectedMinor: number;
  canSubmit: boolean;
  currency: string;
}) {
  const { t, tf } = useT();
  const toast = useToast();
  const submit = useSubmitRemittance();
  const [amountText, setAmountText] = useState(moneyInputText(expectedMinor));
  const [amountMinor, setAmountMinor] = useState<number | null>(expectedMinor);
  const [note, setNote] = useState("");
  // Declaración ya validada a la espera de confirmación explícita (`null` = sin modal).
  const [pending, setPending] = useState<SubmitRemittanceInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = () => {
    setError(null);
    if (amountMinor === null) {
      setError(t("money.required"));
      return;
    }
    const parsed = submitRemittanceInput.safeParse({
      declaredMinor: amountMinor,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("errors.validation"));
      return;
    }
    setPending(parsed.data);
  };

  const confirm = () => {
    if (!pending) return;
    submit.mutate(pending, {
      onSuccess: () => {
        setPending(null);
        toast.show({ title: t("remittance.submit.success"), tone: "success" });
      },
      onError: (err) => {
        setPending(null);
        setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));
      },
    });
  };

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="label">{t("remittance.submit.title")}</Text>
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("remittance.submit.amount")} hint={t("money.hint")} required>
          <MoneyInput
            value={amountText}
            onChangeText={setAmountText}
            onChangeAmount={setAmountMinor}
            currency={currency}
            invalidLabel={t("money.invalid")}
          />
        </Field>
        <Field label={t("remittance.submit.note")}>
          <Input value={note} onChangeText={setNote} multiline />
        </Field>
        <Button
          label={t("remittance.submit.action")}
          loading={submit.isPending}
          disabled={!canSubmit || amountMinor === null}
          block
          onPress={onSubmit}
        />
        {!canSubmit ? (
          <Text variant="caption" tone="muted">
            {t("remittance.submit.nothing")}
          </Text>
        ) : null}
      </Stack>
      <ConfirmModal
        visible={pending !== null}
        title={t("remittance.submit.confirmTitle")}
        description={tf("remittance.submit.confirmBody", {
          declared: formatMoney(pending?.declaredMinor ?? 0, currency),
          expected: formatMoney(expectedMinor, currency),
        })}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        loading={submit.isPending}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
        closeLabel={t("common.close")}
      />
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
