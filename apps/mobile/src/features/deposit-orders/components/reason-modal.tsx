import { useState } from "react";
import { Banner, Button, Field, Input, Modal, Stack } from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCloseDepositOrder } from "../api/queries";

const MIN_REASON_LENGTH = 3;

/** Objetar un reporte o cancelar la orden: siempre con motivo (queda en la bitácora). */
export function ReasonModal({
  orderId,
  action,
  onClose,
}: {
  orderId: string;
  action: "dispute" | "cancel";
  onClose: () => void;
}) {
  const { t } = useT();
  const close = useCloseDepositOrder();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    close.mutate(
      { id: orderId, action, reason: reason.trim() },
      {
        onSuccess: onClose,
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible onClose={onClose} title={t(`deposit.${action}.title`)}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("remittance.debt.reason")} required>
          <Input value={reason} onChangeText={setReason} multiline />
        </Field>
        <Button
          label={t(`deposit.${action}.action`)}
          variant={action === "cancel" ? "danger" : "primary"}
          loading={close.isPending}
          disabled={reason.trim().length < MIN_REASON_LENGTH}
          block
          onPress={submit}
        />
      </Stack>
    </Modal>
  );
}
