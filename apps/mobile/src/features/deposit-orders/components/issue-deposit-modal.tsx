import { useState } from "react";
import type { RemittanceBoardRow } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Field,
  Input,
  majorToMinor,
  minorToMajor,
  Modal,
  MoneyText,
  Row,
  Select,
  Stack,
  Text,
  type SelectOption,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCashBoxes, useFundingBoxes } from "@/features/cash/api/boxes-queries";
import { useIssueDepositOrder } from "../api/queries";

/**
 * El coordinador ordena consignar el efectivo acumulado de un cobrador en una cuenta PIX (caja BANK
 * que su zona puede usar). El monto no puede superar el efectivo en su poder (el servidor lo valida).
 */
export function IssueDepositModal({ row, onClose }: { row: RemittanceBoardRow; onClose: () => void }) {
  const { t } = useT();
  const issue = useIssueDepositOrder();
  const funding = useFundingBoxes(row.zoneId);
  const all = useCashBoxes();
  const [amount, setAmount] = useState(String(minorToMajor(row.cashInHandMinor)));
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Cuentas bancarias disponibles: las de la zona (y superiores); sin zona, las generales.
  const bankOptions: SelectOption<string>[] = row.zoneId
    ? (funding.data?.items ?? []).filter((b) => b.type === "BANK").map((b) => ({ value: b.id, label: b.name }))
    : (all.data?.items ?? [])
        .filter((b) => b.type === "BANK" && b.active && b.zoneId === null)
        .map((b) => ({ value: b.id, label: b.name }));
  const amountMinor = majorToMinor(Number(amount) || 0);

  const submit = () => {
    if (!destinationId) return;
    setError(null);
    issue.mutate(
      {
        collectorId: row.collectorId,
        amountMinor,
        destinationCashBoxId: destinationId,
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      },
      {
        onSuccess: onClose,
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible onClose={onClose} title={t("deposit.issue.title")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Text variant="label">{row.collectorEmail ?? row.cashBoxName}</Text>
        <Row className="items-center justify-between">
          <Text tone="muted">{t("remittance.cashInHand")}</Text>
          <MoneyText variant="label" amountMinor={row.cashInHandMinor} currency={row.currency} />
        </Row>
        <Field label={t("deposit.issue.amount")} required>
          <Input keyboardType="numeric" value={amount} onChangeText={setAmount} />
        </Field>
        <Field label={t("deposit.issue.destination")} required>
          <Select
            value={destinationId}
            options={bankOptions}
            onChange={setDestinationId}
            placeholder={t("deposit.issue.destinationPlaceholder")}
          />
        </Field>
        <Field label={t("deposit.issue.instructions")}>
          <Input value={instructions} onChangeText={setInstructions} multiline />
        </Field>
        <Button
          label={t("deposit.issue.submit")}
          loading={issue.isPending}
          disabled={!destinationId || amountMinor <= 0 || amountMinor > row.cashInHandMinor}
          block
          onPress={submit}
        />
      </Stack>
    </Modal>
  );
}
