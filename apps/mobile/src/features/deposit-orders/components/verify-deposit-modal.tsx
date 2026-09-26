import { useState } from "react";
import { Pressable } from "react-native";
import type { DepositOrder } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Field,
  Input,
  majorToMinor,
  minorToMajor,
  Modal,
  MoneyText,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useDepositBankMatches, useVerifyDeposit } from "../api/queries";

/**
 * Verificación contra el banco: el revisor confirma el monto y, si la sincronización bancaria lo
 * trajo, enlaza el ingreso que corresponde al depósito (queda consumido por la orden y la
 * conciliación de pagos ya no lo ofrece: sin doble ingreso). Nunca es automático.
 */
export function VerifyDepositModal({ order, onClose }: { order: DepositOrder; onClose: () => void }) {
  const { t } = useT();
  const verify = useVerifyDeposit();
  const matches = useDepositBankMatches(order.id);
  const [amount, setAmount] = useState(String(minorToMajor(order.reportedAmountMinor ?? order.amountMinor)));
  const [bankCreditId, setBankCreditId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    verify.mutate(
      {
        id: order.id,
        verifiedAmountMinor: majorToMinor(Number(amount) || 0),
        ...(bankCreditId ? { bankCreditId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: onClose,
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  const items = matches.data?.items ?? [];
  return (
    <Modal visible onClose={onClose} title={t("deposit.verify.title")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("deposit.verify.amount")} required>
          <Input keyboardType="numeric" value={amount} onChangeText={setAmount} />
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
        <Button label={t("deposit.verify.confirm")} loading={verify.isPending} block onPress={submit} />
      </Stack>
    </Modal>
  );
}
