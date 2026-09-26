import { useState } from "react";
import { createExpenseFields } from "@preztiaos/contracts";
import { Banner, Button, Card, Field, Input, majorToMinor, Stack, Text } from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCreateExpense, type PickedReceipt } from "../../api/queries";
import { ReceiptPicker } from "./receipt-picker";

/** Solicitud de gasto: concepto, monto y comprobante obligatorio. */
export function ExpenseRequestForm() {
  const { t } = useT();
  const create = useCreateExpense();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState<PickedReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = () => {
    setError(null);
    setSent(false);
    const parsed = createExpenseFields.safeParse({
      description,
      amountMinor: majorToMinor(Number(amount) || 0),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("errors.validation"));
      return;
    }
    if (!receipt) {
      setError(t("cash.expenses.receipt.required"));
      return;
    }
    create.mutate(
      { ...parsed.data, receipt },
      {
        onSuccess: () => {
          setDescription("");
          setAmount("");
          setReceipt(null);
          setSent(true);
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="label">{t("cash.expenses.requestTitle")}</Text>
        {error ? <Banner tone="danger" title={error} /> : null}
        {sent ? <Banner tone="success" title={t("cash.expenses.sent")} /> : null}
        <Field label={t("cash.expenses.description")} required>
          <Input value={description} onChangeText={setDescription} />
        </Field>
        <Field label={t("cash.expenses.amount")} required>
          <Input value={amount} onChangeText={setAmount} keyboardType="numeric" />
        </Field>
        <ReceiptPicker value={receipt} onChange={setReceipt} onError={setError} />
        <Button
          label={t("cash.expenses.request")}
          loading={create.isPending}
          disabled={!receipt}
          block
          onPress={submit}
        />
      </Stack>
    </Card>
  );
}
