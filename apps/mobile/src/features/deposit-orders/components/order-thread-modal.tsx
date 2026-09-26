import { useState } from "react";
import { Banner, Button, Input, Modal, Spinner, Stack, Text } from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCommentDepositOrder, useDepositOrderEvents } from "../api/queries";

/**
 * Hilo de la orden: la bitácora append-only (emitida, vista, reportada, objetada, verificada,
 * comentarios) con actor y fecha/hora, y un campo para comentar. Es el canal para aclarar cuadres
 * y malentendidos entre el coordinador y el cobrador.
 */
export function OrderThreadModal({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { t } = useT();
  const events = useDepositOrderEvents(orderId);
  const comment = useCommentDepositOrder();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    if (!orderId || !message.trim()) return;
    setError(null);
    comment.mutate(
      { id: orderId, message: message.trim() },
      {
        onSuccess: () => {
          setMessage("");
          void events.refetch();
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible={orderId != null} onClose={onClose} title={t("deposit.thread")}>
      <Stack gap="sm" className="p-4">
        {events.isPending ? <Spinner label={t("common.loading")} /> : null}
        {(events.data?.items ?? []).map((e) => (
          <Stack key={e.id} gap="xs" className="border-b border-zinc-100 pb-2 dark:border-zinc-800">
            <Text variant="label">{t(`deposit.event.${e.type}`)}</Text>
            <Text variant="caption" tone="muted">
              {e.actorEmail ?? e.actorId} · {new Date(e.createdAt).toLocaleString()}
            </Text>
            {e.message ? <Text variant="body">{e.message}</Text> : null}
          </Stack>
        ))}
        {error ? <Banner tone="danger" title={error} /> : null}
        <Input value={message} onChangeText={setMessage} placeholder={t("deposit.comment.placeholder")} multiline />
        <Button
          label={t("deposit.comment.send")}
          loading={comment.isPending}
          disabled={!message.trim()}
          block
          onPress={send}
        />
      </Stack>
    </Modal>
  );
}
