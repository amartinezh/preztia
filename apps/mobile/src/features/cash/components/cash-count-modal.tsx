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
import { usePerformCashCount } from "../api/boxes-queries";

type Box = { id: string; name: string; currency: string };

/** Modal de arqueo: el operador reporta el conteo físico y el sistema muestra el descuadre. */
export function CashCountModal({
  box,
  visible,
  onClose,
}: {
  box: Box | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const count = usePerformCashCount();
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const result = count.data;

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

  const close = () => {
    count.reset();
    setCounted("");
    setNotes("");
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
              <Text tone="muted">{t("cash.arqueo.counted")}</Text>
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
            <Button label={t("common.close")} variant="secondary" block onPress={close} />
          </Stack>
        ) : (
          <Stack gap="sm">
            <Field label={t("cash.arqueo.counted")} required>
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
