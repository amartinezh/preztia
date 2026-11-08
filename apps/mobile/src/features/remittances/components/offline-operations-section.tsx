import { useState, type ReactNode } from "react";
import { View } from "react-native";
import {
  Badge,
  Button,
  Card,
  ConfirmModal,
  formatMoney,
  minorToMajor,
  Row,
  Stack,
  Text,
  useToast,
} from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { discardFailed, flush, retryFailed, type FailedOperation, type QueuedOperation } from "@/core/offline/queue";
import { readCreditPayload, useOfflineOperations } from "@/core/offline/use-offline-operations";

const CREDIT_ID_PREVIEW = 8;

/**
 * "Pendientes de envío" del cobrador: cada abono guardado sin señal con su estado (pendiente o
 * rechazado con el motivo) y, para los rechazados, reintentar o descartar a conciencia. Se
 * oculta cuando la cola está vacía. No conoce el endpoint: opera sobre la cola genérica.
 */
export function OfflineOperationsSection({ currency }: { currency: string | null }) {
  const { t, tf } = useT();
  const toast = useToast();
  const { pending, failed } = useOfflineOperations();
  const [discarding, setDiscarding] = useState<FailedOperation | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (pending.length === 0 && failed.length === 0) return null;

  const retry = async (op: FailedOperation) => {
    setBusyId(op.id);
    try {
      await retryFailed(op.id);
      const result = await flush();
      if (result.processed > 0) toast.show({ tone: "success", title: t("offline.op.retrySent") });
      else if (result.dropped > 0) toast.show({ tone: "danger", title: t("offline.op.retryRejected") });
      else toast.show({ tone: "info", title: t("offline.op.retryQueued") });
    } finally {
      setBusyId(null);
    }
  };

  const discard = async () => {
    if (!discarding) return;
    setBusyId(discarding.id);
    try {
      await discardFailed(discarding.id);
      toast.show({ tone: "info", title: t("offline.op.discarded") });
    } finally {
      setBusyId(null);
      setDiscarding(null);
    }
  };

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">{t("offline.section.title")}</Text>
        <Text variant="caption" tone="muted">
          {t("offline.section.hint")}
        </Text>
        {pending.map((op) => (
          <OperationRow key={op.id} op={op} currency={currency} status={<Badge tone="warning" label={t("offline.op.pending")} />} />
        ))}
        {failed.map((op) => (
          <OperationRow
            key={op.id}
            op={op}
            currency={currency}
            status={<Badge tone="danger" label={t("offline.op.rejected")} />}
            reason={t(op.reason)}
            actions={
              <Row gap="sm">
                <Button
                  label={t("offline.op.retry")}
                  size="sm"
                  variant="secondary"
                  loading={busyId === op.id}
                  disabled={busyId !== null}
                  onPress={() => void retry(op)}
                />
                <Button
                  label={t("offline.op.discard")}
                  size="sm"
                  variant="ghost"
                  disabled={busyId !== null}
                  onPress={() => setDiscarding(op)}
                />
              </Row>
            }
          />
        ))}
      </Stack>
      <ConfirmModal
        visible={discarding !== null}
        title={t("offline.op.discardTitle")}
        description={
          discarding
            ? tf("offline.op.discardBody", {
                amount: amountLabel(discarding, currency),
                credit: creditLabel(discarding, tf),
              })
            : undefined
        }
        tone="danger"
        confirmLabel={t("offline.op.discard")}
        cancelLabel={t("common.cancel")}
        loading={busyId !== null && busyId === discarding?.id}
        onConfirm={() => void discard()}
        onCancel={() => setDiscarding(null)}
        closeLabel={t("common.close")}
      />
    </Card>
  );
}

function OperationRow({
  op,
  currency,
  status,
  reason,
  actions,
}: {
  op: QueuedOperation;
  currency: string | null;
  status: ReactNode;
  reason?: string;
  actions?: ReactNode;
}) {
  const { tf, locale } = useT();
  return (
    <View className="gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <Row className="items-center justify-between">
        <Stack gap="xs" className="flex-1">
          <Text variant="label">{amountLabel(op, currency)}</Text>
          <Text variant="caption" tone="muted">
            {creditLabel(op, tf)} · {capturedAt(op.createdAt, locale)}
          </Text>
        </Stack>
        {status}
      </Row>
      {reason ? (
        <Text variant="caption" tone="danger">
          {reason}
        </Text>
      ) : null}
      {actions}
    </View>
  );
}

/** Monto del abono; sin moneda conocida (pantalla sin datos aún) se muestra el número a secas. */
function amountLabel(op: QueuedOperation, currency: string | null): string {
  const credit = readCreditPayload(op.payload);
  if (!credit || credit.amountMinor === null) return "—";
  return currency ? formatMoney(credit.amountMinor, currency) : minorToMajor(credit.amountMinor).toLocaleString("es-CO");
}

/** "Crédito abcd1234": la cola no guarda el nombre del cliente; el crédito identifica el abono. */
function creditLabel(op: QueuedOperation, tf: (key: "offline.op.credit", vars: { id: string }) => string): string {
  const credit = readCreditPayload(op.payload);
  return tf("offline.op.credit", { id: credit ? credit.creditId.slice(0, CREDIT_ID_PREVIEW) : "—" });
}

function capturedAt(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
