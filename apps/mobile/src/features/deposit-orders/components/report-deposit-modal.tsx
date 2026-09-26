import { useState } from "react";
import type { DepositOrder } from "@preztiaos/contracts";
import { Banner, Button, Field, Input, majorToMinor, minorToMajor, Modal, Stack } from "@preztiaos/ui";

import { ReceiptPicker } from "@/components/receipt-picker";
import type { PickedFile } from "@/core/api/multipart";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useReportDeposit } from "../api/queries";

const pad = (n: number) => String(n).padStart(2, "0");

/** "AAAA-MM-DD HH:MM" en hora local del dispositivo. */
function localStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Interpreta "AAAA-MM-DD HH:MM" como hora local; null si no es válida. */
function parseLocalStamp(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** El cobrador reporta la consignación: monto, fecha/hora, referencia y foto obligatoria. */
export function ReportDepositModal({ order, onClose }: { order: DepositOrder; onClose: () => void }) {
  const { t } = useT();
  const report = useReportDeposit();
  const [amount, setAmount] = useState(String(minorToMajor(order.amountMinor)));
  const [when, setWhen] = useState(localStamp(new Date()));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState<PickedFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const depositedAt = parseLocalStamp(when);
    const amountMinor = majorToMinor(Number(amount) || 0);
    if (!depositedAt || amountMinor <= 0) {
      setError(t("errors.validation"));
      return;
    }
    if (!receipt) {
      setError(t("cash.expenses.receipt.required"));
      return;
    }
    report.mutate(
      {
        id: order.id,
        amountMinor,
        depositedAt: depositedAt.toISOString(),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        receipt,
      },
      {
        onSuccess: onClose,
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible onClose={onClose} title={t("deposit.report.title")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("deposit.report.amount")} required>
          <Input keyboardType="numeric" value={amount} onChangeText={setAmount} />
        </Field>
        <Field label={t("deposit.report.when")} hint="AAAA-MM-DD HH:MM" required>
          <Input value={when} onChangeText={setWhen} />
        </Field>
        <Field label={t("deposit.report.reference")}>
          <Input value={reference} onChangeText={setReference} />
        </Field>
        <Field label={t("deposit.report.note")}>
          <Input value={note} onChangeText={setNote} multiline />
        </Field>
        <ReceiptPicker value={receipt} onChange={setReceipt} onError={setError} />
        <Button label={t("deposit.report.submit")} loading={report.isPending} disabled={!receipt} block onPress={submit} />
      </Stack>
    </Modal>
  );
}
