import { useState } from "react";
import {
  Badge,
  Banner,
  Button,
  ConfirmModal,
  Field,
  formatMoney,
  Input,
  MoneyInput,
  MoneyText,
  Modal,
  Row,
  Stack,
  Text,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useAdjustCashBalance, usePerformCashCount } from "../api/boxes-queries";

// `balanceMinor` es el saldo del libro: lo que el arqueo compara y lo que la confirmación anuncia.
type Box = { id: string; name: string; currency: string; type: "CASH" | "BANK" | "TRANSIT"; balanceMinor: number };

/** Qué sello irreversible está esperando confirmación: el arqueo o el ajuste al arqueo. */
type Confirming = "count" | "adjust" | null;

/**
 * Modal de arqueo + ajuste: el operador reporta el valor real (conteo físico o saldo del banco),
 * el sistema muestra el descuadre y, si el rol lo permite, ofrece sellarlo con un asiento de
 * AJUSTE por la diferencia exacta (motivo obligatorio). El ajuste referencia el arqueo recién
 * registrado: nunca es un monto libre. Arqueo y ajuste quedan sellados (append-only), así que
 * ambos se confirman mostrando contado vs. libro antes de enviar.
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
  const { t, tf } = useT();
  const count = usePerformCashCount();
  const adjust = useAdjustCashBalance();
  const [countedText, setCountedText] = useState("");
  const [countedMinor, setCountedMinor] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [error, setError] = useState<string | null>(null);
  const currency = box?.currency ?? "COP";
  const money = (minor: number) => formatMoney(minor, currency);

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
    if (!box || countedMinor === null) return;
    setConfirming(null);
    setError(null);
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
    setConfirming(null);
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
    setCountedText("");
    setNotes("");
    setReason("");
    setConfirming(null);
    setError(null);
    onClose();
  };

  // Resumen de lo que se va a sellar: ajuste (contado vs. diferencia) o arqueo (contado vs. libro).
  const confirmDescription =
    confirming === "adjust" && result
      ? tf("cash.adjust.confirmBody", { counted: money(result.countedMinor), diff: money(result.differenceMinor) })
      : countedMinor === 0
        ? tf("cash.count.zeroBody", { box: box?.name ?? "", expected: money(box?.balanceMinor ?? 0) })
        : tf("cash.count.confirmBody", { counted: money(countedMinor ?? 0), expected: money(box?.balanceMinor ?? 0) });

  return (
    <Modal visible={visible} onClose={close} title={t("cash.arqueo.title")} closeLabel={t("common.close")}>
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
                  onPress={() => setConfirming("adjust")}
                />
              </Stack>
            ) : null}

            <Button label={t("common.close")} variant="secondary" block onPress={close} />
          </Stack>
        ) : (
          <Stack gap="sm">
            <Field label={countedLabel} hint={t("money.hint")} required>
              <MoneyInput
                value={countedText}
                onChangeText={setCountedText}
                onChangeAmount={setCountedMinor}
                currency={currency}
                invalidLabel={t("money.invalid")}
              />
            </Field>
            <Field label={t("cash.arqueo.notes")}>
              <Input value={notes} onChangeText={setNotes} />
            </Field>
            <Button
              label={t("cash.arqueo.submit")}
              loading={count.isPending}
              disabled={countedMinor === null}
              block
              onPress={() => setConfirming("count")}
            />
          </Stack>
        )}
      </Stack>
      <ConfirmModal
        visible={confirming !== null}
        title={confirming === "adjust" ? t("cash.adjust.confirmTitle") : t("cash.count.confirmTitle")}
        description={confirmDescription}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        loading={count.isPending || adjust.isPending}
        onConfirm={confirming === "adjust" ? submitAdjust : submit}
        onCancel={() => setConfirming(null)}
        closeLabel={t("common.close")}
      />
    </Modal>
  );
}
