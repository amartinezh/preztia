import { useState } from "react";
import type { Expense } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  ConfirmModal,
  Field,
  formatMoney,
  Input,
  Modal,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCashBoxes, useFundingBoxes } from "../../api/boxes-queries";
import { useReviewExpense } from "../../api/queries";
import { PayingBoxPicker, type PayingBoxOption } from "../paying-box-picker";
import { ReceiptThumbnail } from "../receipt-thumbnail";

/**
 * Opciones de pago del gasto: la caja de ruta de quien lo pidió (se descuenta de su efectivo y entra
 * en su rendición) y las cajas de oficina/banco que su zona puede usar. Un gasto sin zona se paga
 * con cajas generales del tenant. El servidor vuelve a validar la regla y el saldo.
 */
function usePayingOptions(expense: Expense): { options: PayingBoxOption[]; loading: boolean } {
  const { t } = useT();
  const funding = useFundingBoxes(expense.zoneId);
  const all = useCashBoxes();
  const route: PayingBoxOption[] = expense.requesterRouteBox
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
  const { t, tf } = useT();
  const review = useReviewExpense();
  const { options, loading } = usePayingOptions(expense);
  const [boxId, setBoxId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const selected = options.find((o) => o.id === boxId) ?? null;
  const insufficient = selected?.balanceMinor != null && selected.balanceMinor < expense.amountMinor;

  // Aprobar mueve dinero: se confirma antes (monto y caja); el error queda en el Banner del modal.
  const decide = (approve: boolean) => {
    setError(null);
    review.mutate(
      approve
        ? { id: expense.id, approve, ...(boxId ? { paidFromCashBoxId: boxId } : {}) }
        : { id: expense.id, approve, rejectionReason: reason.trim() },
      {
        onSettled: () => setConfirmingApprove(false),
        onSuccess: onClose,
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible onClose={onClose} title={t("cash.expenses.review")} closeLabel={t("common.close")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        {/* Lo que se decide, a la vista: concepto, monto y caja pagadora junto al comprobante. */}
        <Stack gap="xs" className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <Row className="items-center justify-between">
            <Text tone="muted">{t("expenses.review.concept")}</Text>
            <Text variant="label" className="flex-1 pl-3 text-right">
              {expense.description}
            </Text>
          </Row>
          <Row className="items-center justify-between">
            <Text tone="muted">{t("expenses.review.amount")}</Text>
            <MoneyText variant="label" amountMinor={expense.amountMinor} currency={currency} />
          </Row>
          <Row className="items-center justify-between">
            <Text tone="muted">{t("expenses.review.payingBox")}</Text>
            <Text variant="label" tone={selected ? "default" : "muted"}>
              {selected?.name ?? t("expenses.review.payingBoxUnset")}
            </Text>
          </Row>
        </Stack>
        {expense.hasReceipt ? (
          <ReceiptThumbnail path={`/expenses/${expense.id}/receipt`} title={t("cash.expenses.receipt")} />
        ) : (
          <Text variant="caption" tone="muted">
            {t("receipt.none")}
          </Text>
        )}

        <Field label={t("cash.expenses.paidFrom")} hint={t("cash.expenses.paidFromHint")} required>
          {loading ? (
            <Spinner label={t("common.loading")} />
          ) : options.length === 0 ? (
            <Banner tone="warning" title={t("cash.expenses.paidFromEmpty")} />
          ) : (
            <PayingBoxPicker options={options} selectedId={boxId} currency={currency} onSelect={setBoxId} />
          )}
        </Field>
        {insufficient ? <Banner tone="danger" title={t("review.approve.fundingInsufficient")} /> : null}
        <Button
          label={t("cash.expenses.approve")}
          loading={review.isPending}
          disabled={!boxId || insufficient}
          block
          onPress={() => setConfirmingApprove(true)}
        />
        {!boxId && !loading ? (
          <Text variant="caption" tone="muted" className="text-center">
            {t("cash.expenses.needPaidFrom")}
          </Text>
        ) : null}
        <ConfirmModal
          visible={confirmingApprove}
          title={t("expenses.approve.confirmTitle")}
          description={tf("expenses.approve.confirmBody", {
            amount: formatMoney(expense.amountMinor, currency),
            box: selected?.name ?? "",
          })}
          confirmLabel={t("cash.expenses.approve")}
          cancelLabel={t("common.cancel")}
          closeLabel={t("common.close")}
          loading={review.isPending}
          onConfirm={() => decide(true)}
          onCancel={() => setConfirmingApprove(false)}
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
