import { useState } from "react";
import { Banner, Button, Field, Modal, MoneyText, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCashBoxes, useFundingBoxes } from "@/features/cash/api/boxes-queries";
import { PayingBoxPicker, type PayingBoxOption } from "@/features/cash/components/paying-box-picker";
import { usePayCommission } from "../api/queries";

/** Cobrador a quien se le paga la comisión causada en la liquidación. */
export interface CommissionPayee {
  collectorId: string;
  label: string;
  zoneId: string | null;
  amountMinor: number;
}

/**
 * Cajas desde las que se puede pagar: la caja de ruta del propio cobrador (se la queda del efectivo
 * que tiene) y las de oficina o banco que su zona usa; sin zona, las generales del tenant. Es la
 * misma regla que el servidor vuelve a validar (`assertCanPayCommissionFrom`) junto con el saldo.
 */
function usePayingOptions(payee: CommissionPayee): { options: PayingBoxOption[]; loading: boolean } {
  const { t } = useT();
  const all = useCashBoxes();
  const funding = useFundingBoxes(payee.zoneId);
  const boxes = all.data?.items ?? [];
  const route: PayingBoxOption[] = boxes
    .filter((b) => b.active && b.assignedTo === payee.collectorId)
    .map((b) => ({ id: b.id, name: b.name, balanceMinor: null, hint: t("settlement.commissions.routeBoxHint") }));
  if (payee.zoneId) {
    const zoneBoxes = (funding.data?.items ?? []).map((b) => ({ id: b.id, name: b.name, balanceMinor: b.balanceMinor }));
    return { options: [...route, ...zoneBoxes], loading: all.isPending || funding.isPending };
  }
  const tenantBoxes = boxes
    .filter((b) => b.active && b.type !== "TRANSIT" && b.assignedTo === null && b.zoneId === null)
    .map((b) => ({ id: b.id, name: b.name, balanceMinor: null }));
  return { options: [...route, ...tenantBoxes], loading: all.isPending };
}

export function CommissionPayModal({
  settlementId,
  payee,
  currency,
  onClose,
}: {
  settlementId: string;
  payee: CommissionPayee;
  currency: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const pay = usePayCommission(settlementId);
  const { options, loading } = usePayingOptions(payee);
  const [boxId, setBoxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = options.find((o) => o.id === boxId) ?? null;
  const insufficient = selected?.balanceMinor != null && selected.balanceMinor < payee.amountMinor;

  const confirm = () => {
    if (!boxId) return;
    setError(null);
    pay.mutate(
      { collectorId: payee.collectorId, cashBoxId: boxId },
      {
        onSuccess: onClose,
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible onClose={onClose} title={t("settlement.commissions.payTitle")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Row className="items-center justify-between">
          <Text variant="label" className="flex-1 pr-2">
            {payee.label}
          </Text>
          <MoneyText variant="label" amountMinor={payee.amountMinor} currency={currency} />
        </Row>
        <Field label={t("settlement.commissions.payFrom")}>
          {loading ? (
            <Spinner label={t("common.loading")} />
          ) : options.length === 0 ? (
            <Banner tone="warning" title={t("settlement.commissions.noBoxes")} />
          ) : (
            <PayingBoxPicker options={options} selectedId={boxId} currency={currency} onSelect={setBoxId} />
          )}
        </Field>
        {insufficient ? <Banner tone="danger" title={t("review.approve.fundingInsufficient")} /> : null}
        <Button
          label={t("settlement.commissions.confirm")}
          loading={pay.isPending}
          disabled={!boxId || insufficient}
          block
          onPress={confirm}
        />
      </Stack>
    </Modal>
  );
}
