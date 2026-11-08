import { useState } from "react";
import { createExpenseFields } from "@preztiaos/contracts";
import { Banner, Button, Card, Field, Input, MoneyInput, Stack, Text } from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useMyCashBox } from "../../api/boxes-queries";
import { useCreateExpense, type PickedReceipt } from "../../api/queries";
import { ReceiptPicker } from "@/components/receipt-picker";

/**
 * Solicitud de gasto: concepto, monto y comprobante obligatorio. `currency` es la del libro; si la
 * pantalla no la pasa, se toma de la caja de ruta de quien solicita (de ahí sale el gasto).
 */
export function ExpenseRequestForm({ currency }: { currency?: string } = {}) {
  return currency === undefined ? <RouteBoxCurrencyForm /> : <RequestForm currency={currency} />;
}

/** Variante sin moneda explícita: la consulta solo cuando hace falta (no en cada pantalla). */
function RouteBoxCurrencyForm() {
  const myBox = useMyCashBox();
  return <RequestForm currency={myBox.data?.box?.currency ?? ""} />;
}

function RequestForm({ currency }: { currency: string }) {
  const { t } = useT();
  const create = useCreateExpense();
  const [description, setDescription] = useState("");
  const [amountText, setAmountText] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<PickedReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = () => {
    setError(null);
    setSent(false);
    if (amountMinor === null) {
      setError(t("money.required"));
      return;
    }
    const parsed = createExpenseFields.safeParse({ description, amountMinor });
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
          setAmountText("");
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
        <Field label={t("cash.expenses.amount")} hint={t("money.hint")} required>
          <MoneyInput
            value={amountText}
            onChangeText={setAmountText}
            onChangeAmount={setAmountMinor}
            currency={currency}
            invalidLabel={t("money.invalid")}
          />
        </Field>
        <ReceiptPicker value={receipt} onChange={setReceipt} onError={setError} />
        <Button
          label={t("cash.expenses.request")}
          loading={create.isPending}
          disabled={!receipt || amountMinor === null}
          block
          onPress={submit}
        />
      </Stack>
    </Card>
  );
}
