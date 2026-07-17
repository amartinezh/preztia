import { useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Field,
  Input,
  majorToMinor,
  MoneyText,
  Modal,
  Row,
  Stack,
  Text,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useAdjustCashBalance, usePerformCashCount } from "../api/boxes-queries";

type Box = { id: string; name: string; currency: string; type: "CASH" | "BANK" | "TRANSIT" };

/**
 * Modal de arqueo + ajuste: el operador reporta el valor real (conteo físico o saldo del banco),
 * el sistema muestra el descuadre y, si el rol lo permite, ofrece sellarlo con un asiento de
 * AJUSTE por la diferencia exacta (motivo obligatorio). El ajuste referencia el arqueo recién
 * registrado: nunca es un monto libre.
 */
export function CashCountModal({
  box,
  visible,
  canAdjust,
  onClose,
}: {
  box: Box | null;
  visible: boolean;
  /** ADMIN/COORDINATOR: puede sellar el descuadre con un ajuste (el server lo re-verifica). */
  canAdjust: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const count = usePerformCashCount();
  const adjust = useAdjustCashBalance();
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const result = count.data;
  const adjusted = adjust.data;
  // Para una caja bancaria el "conteo" es el saldo real reportado por el banco.
  const countedLabel = box?.type === "BANK" ? t("cash.arqueo.bankBalance") : t("cash.arqueo.counted");
  // La caja de tránsito solo libera fondos reclasificando (transferencia): sin ajuste de faltante.
  const offerAdjust =
    canAdjust &&
    result !== undefined &&
    !result.isBalanced &&
    !adjusted &&
    (box?.type !== "TRANSIT" || result.differenceMinor > 0);

  const submit = () => {
    if (!box) return;
    setError(null);
    const countedMinor = majorToMinor(Number(counted) || 0);
    count.mutate(
      { boxId: box.id, countedMinor, ...(notes.trim() ? { notes: notes.trim() } : {}) },
      {
        onError: (err) =>
          setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  const submitAdjust = () => {
    if (!box || !result || !reason.trim()) return;
    setError(null);
    adjust.mutate(
      { boxId: box.id, cashCountId: result.id, reason: reason.trim() },
      {
        onError: (err) =>
          setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  const close = () => {
    count.reset();
    adjust.reset();
    setCounted("");
    setNotes("");
    setReason("");
    setError(null);
    onClose();
  };

  return (
    <Modal visible={visible} onClose={close} title={t("cash.arqueo.title")}>
      <Stack gap="sm">
        {box ? <Text variant="label">{box.name}</Text> : null}
        {error ? <Banner tone="danger" title={error} /> : null}

        {result ? (
          <Stack gap="xs">
            <Row className="justify-between">
              <Text tone="muted">{t("cash.arqueo.system")}</Text>
              <MoneyText variant="label" amountMinor={result.systemMinor} currency={box?.currency ?? "COP"} />
            </Row>
            <Row className="justify-between">
              <Text tone="muted">{countedLabel}</Text>
              <MoneyText variant="label" amountMinor={result.countedMinor} currency={box?.currency ?? "COP"} />
            </Row>
            <Row className="justify-between items-center">
              <Text tone="muted">
                {result.isBalanced ? t("cash.arqueo.balanced") : t("cash.arqueo.difference")}
              </Text>
              {result.isBalanced ? (
                <Badge label={t("cash.arqueo.balanced")} tone="success" />
              ) : (
                <MoneyText variant="label" tone="danger" amountMinor={result.differenceMinor} currency={box?.currency ?? "COP"} />
              )}
            </Row>

            {adjusted ? <Banner tone="success" title={t("cash.adjust.done")} /> : null}

            {offerAdjust ? (
              <Stack gap="sm">
                <Text variant="caption" tone="muted">
                  {t("cash.adjust.hint")}
                </Text>
                <Field label={t("cash.adjust.reason")} required>
                  <Input value={reason} onChangeText={setReason} />
                </Field>
                <Button
                  label={t("cash.adjust.cta")}
                  variant="danger"
                  loading={adjust.isPending}
                  disabled={reason.trim().length < 3}
                  block
                  onPress={submitAdjust}
                />
              </Stack>
            ) : null}

            <Button label={t("common.close")} variant="secondary" block onPress={close} />
          </Stack>
        ) : (
          <Stack gap="sm">
            <Field label={countedLabel} required>
              <Input value={counted} onChangeText={setCounted} keyboardType="numeric" />
            </Field>
            <Field label={t("cash.arqueo.notes")}>
              <Input value={notes} onChangeText={setNotes} />
            </Field>
            <Button
              label={t("cash.arqueo.submit")}
              loading={count.isPending}
              block
              onPress={submit}
            />
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
