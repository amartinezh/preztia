import { useState } from "react";
import { Pressable } from "react-native";
import type { DepositOrder } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  ConfirmModal,
  Field,
  formatMoney,
  Input,
  Modal,
  MoneyInput,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { moneyInputText } from "@/components/money-input-text";
import { ReceiptThumbnail } from "@/features/cash/components/receipt-thumbnail";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useDepositBankMatches, useVerifyDeposit } from "../api/queries";

/**
 * Verificación contra el banco: el revisor confirma el monto y, si la sincronización bancaria lo
 * trajo, enlaza el ingreso que corresponde al depósito (queda consumido por la orden y la
 * conciliación de pagos ya no lo ofrece: sin doble ingreso). Nunca es automático y, como no se
 * puede deshacer, se confirma el monto antes de enviar.
 */
export function VerifyDepositModal({ order, onClose }: { order: DepositOrder; onClose: () => void }) {
  const { t, tf } = useT();
  const verify = useVerifyDeposit();
  const matches = useDepositBankMatches(order.id);
  const initialMinor = order.reportedAmountMinor ?? order.amountMinor;
  const [amountText, setAmountText] = useState(moneyInputText(initialMinor));
  const [amountMinor, setAmountMinor] = useState<number | null>(initialMinor);
  const [bankCreditId, setBankCreditId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    if (amountMinor === null) return;
    setError(null);
    verify.mutate(
      {
        id: order.id,
        verifiedAmountMinor: amountMinor,
        ...(bankCreditId ? { bankCreditId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: onClose,
        onError: (err) => {
          setConfirming(false);
          setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));
        },
      },
    );
  };

  const items = matches.data?.items ?? [];
  return (
    <Modal visible onClose={onClose} title={t("deposit.verify.title")} closeLabel={t("common.close")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        {/* Comparativa a la vista: lo ordenado, lo reportado y lo que se va a verificar. */}
        <Stack gap="xs" className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <Row className="items-center justify-between">
            <Text tone="muted">{t("deposit.verify.ordered")}</Text>
            <MoneyText variant="label" amountMinor={order.amountMinor} currency={order.currency} />
          </Row>
          <Row className="items-center justify-between">
            <Text tone="muted">{t("deposit.verify.reportedAmount")}</Text>
            {order.reportedAmountMinor !== null ? (
              <MoneyText variant="label" amountMinor={order.reportedAmountMinor} currency={order.currency} />
            ) : (
              <Text variant="label" tone="muted">
                —
              </Text>
            )}
          </Row>
          <Row className="items-center justify-between">
            <Text tone="muted">{t("deposit.verify.toVerify")}</Text>
            {amountMinor !== null ? (
              <MoneyText variant="label" amountMinor={amountMinor} currency={order.currency} />
            ) : (
              <Text variant="label" tone="danger">
                {t("money.invalid")}
              </Text>
            )}
          </Row>
          {amountMinor !== null && amountMinor !== order.amountMinor ? (
            <Row className="items-center justify-between">
              <Text tone="danger">{t("deposit.verify.difference")}</Text>
              <MoneyText
                variant="label"
                tone="danger"
                amountMinor={amountMinor - order.amountMinor}
                currency={order.currency}
              />
            </Row>
          ) : amountMinor !== null ? (
            <Text variant="caption" tone="success">
              {t("deposit.verify.noDifference")}
            </Text>
          ) : null}
        </Stack>
        {order.hasReceipt ? (
          <ReceiptThumbnail path={`/deposit-orders/${order.id}/receipt`} title={t("cash.expenses.receipt")} />
        ) : (
          <Text variant="caption" tone="muted">
            {t("receipt.none")}
          </Text>
        )}
        <Field label={t("deposit.verify.amount")} hint={t("money.hint")} required>
          <MoneyInput
            value={amountText}
            onChangeText={setAmountText}
            onChangeAmount={setAmountMinor}
            currency={order.currency}
            invalidLabel={t("money.invalid")}
          />
        </Field>
        <Field label={t("deposit.verify.bankMatch")} hint={t("deposit.verify.bankMatchHint")}>
          {matches.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : items.length === 0 ? (
            <Text variant="caption" tone="muted">
              {t("deposit.verify.noMatches")}
            </Text>
          ) : (
            <Stack gap="xs">
              {items.map((m) => {
                const selected = m.id === bankCreditId;
                return (
                  <Pressable
                    key={m.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setBankCreditId(selected ? null : m.id)}
                    className={`min-h-[48px] flex-row items-center justify-between rounded-xl border px-3 ${
                      selected ? "border-brand-600 bg-brand-50 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-700"
                    }`}
                  >
                    <Text variant="caption" tone={selected ? "primary" : "muted"}>
                      {new Date(m.receivedAt).toLocaleString()}
                      {m.endToEndId ? ` · ${m.endToEndId}` : ""}
                    </Text>
                    <MoneyText variant="label" amountMinor={m.amountMinor} currency={order.currency} />
                  </Pressable>
                );
              })}
            </Stack>
          )}
        </Field>
        <Field label={t("deposit.report.note")}>
          <Input value={note} onChangeText={setNote} multiline />
        </Field>
        <Button
          label={t("deposit.verify.confirm")}
          loading={verify.isPending}
          disabled={amountMinor === null || amountMinor <= 0}
          block
          onPress={() => setConfirming(true)}
        />
      </Stack>
      <ConfirmModal
        visible={confirming}
        title={t("deposit.verify.confirmTitle")}
        description={tf("deposit.verify.confirmBody", { amount: formatMoney(amountMinor ?? 0, order.currency) })}
        confirmLabel={t("deposit.verify.confirm")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        loading={verify.isPending}
        onConfirm={send}
        onCancel={() => setConfirming(false)}
        closeLabel={t("common.close")}
      />
    </Modal>
  );
}
