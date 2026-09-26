import { useState } from "react";
import { Pressable } from "react-native";
import type { Expense } from "@preztiaos/contracts";
import { Banner, Button, Field, Input, Modal, MoneyText, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCashBoxes, useFundingBoxes } from "../../api/boxes-queries";
import { useReviewExpense } from "../../api/queries";

interface PayingOption {
  id: string;
  name: string;
  balanceMinor: number | null;
  hint?: string;
}

/**
 * Opciones de pago del gasto: la caja de ruta de quien lo pidió (se descuenta de su efectivo y entra
 * en su rendición) y las cajas de oficina/banco que su zona puede usar. Un gasto sin zona se paga
 * con cajas generales del tenant. El servidor vuelve a validar la regla y el saldo.
 */
function usePayingOptions(expense: Expense): { options: PayingOption[]; loading: boolean } {
  const { t } = useT();
  const funding = useFundingBoxes(expense.zoneId);
  const all = useCashBoxes();
  const route: PayingOption[] = expense.requesterRouteBox
    ? [{ ...expense.requesterRouteBox, hint: t("cash.expenses.routeBoxHint") }]
    : [];
  if (expense.zoneId) {
    const zoneBoxes = (funding.data?.items ?? []).map((b) => ({ id: b.id, name: b.name, balanceMinor: b.balanceMinor }));
    return { options: [...route, ...zoneBoxes], loading: funding.isPending };
  }
  const tenantBoxes = (all.data?.items ?? [])
    .filter((b) => b.active && b.type !== "TRANSIT" && b.assignedTo === null && b.zoneId === null)
    .map((b) => ({ id: b.id, name: b.name, balanceMinor: null }));
  return { options: [...route, ...tenantBoxes], loading: all.isPending };
}

export function ExpenseReviewModal({
  expense,
  currency,
  onClose,
}: {
  expense: Expense;
  currency: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const review = useReviewExpense();
  const { options, loading } = usePayingOptions(expense);
  const [boxId, setBoxId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selected = options.find((o) => o.id === boxId) ?? null;
  const insufficient = selected?.balanceMinor != null && selected.balanceMinor < expense.amountMinor;

  const decide = (approve: boolean) => {
    setError(null);
    review.mutate(
      approve
        ? { id: expense.id, approve, ...(boxId ? { paidFromCashBoxId: boxId } : {}) }
        : { id: expense.id, approve, rejectionReason: reason.trim() },
      {
        onSuccess: onClose,
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible onClose={onClose} title={t("cash.expenses.review")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Row className="items-center justify-between">
          <Text variant="label" className="flex-1 pr-2">
            {expense.description}
          </Text>
          <MoneyText variant="label" amountMinor={expense.amountMinor} currency={currency} />
        </Row>

        <Field label={t("cash.expenses.paidFrom")} hint={t("cash.expenses.paidFromHint")}>
          {loading ? (
            <Spinner label={t("common.loading")} />
          ) : options.length === 0 ? (
            <Banner tone="warning" title={t("cash.expenses.paidFromEmpty")} />
          ) : (
            <Stack gap="xs">
              {options.map((o) => {
                const isSelected = o.id === boxId;
                return (
                  <Pressable
                    key={o.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => setBoxId(o.id)}
                    className={`min-h-[48px] flex-row items-center justify-between rounded-xl border px-3 ${
                      isSelected ? "border-brand-600 bg-brand-50 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-700"
                    }`}
                  >
                    <Stack gap="xs" className="flex-1 pr-2">
                      <Text variant="label" tone={isSelected ? "primary" : "muted"}>
                        {o.name}
                      </Text>
                      {o.hint ? (
                        <Text variant="caption" tone="muted">
                          {o.hint}
                        </Text>
                      ) : null}
                    </Stack>
                    {o.balanceMinor != null ? (
                      <MoneyText variant="label" amountMinor={o.balanceMinor} currency={currency} />
                    ) : null}
                  </Pressable>
                );
              })}
            </Stack>
          )}
        </Field>
        {insufficient ? <Banner tone="danger" title={t("review.approve.fundingInsufficient")} /> : null}
        <Button
          label={t("cash.expenses.approve")}
          loading={review.isPending}
          disabled={!boxId || insufficient}
          block
          onPress={() => decide(true)}
        />

        <Field label={t("cash.expenses.rejectionReason")} required>
          <Input value={reason} onChangeText={setReason} multiline />
        </Field>
        <Button
          label={t("cash.expenses.reject")}
          variant="danger"
          loading={review.isPending}
          disabled={reason.trim().length < 3}
          block
          onPress={() => decide(false)}
        />
      </Stack>
    </Modal>
  );
}
