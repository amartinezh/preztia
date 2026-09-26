import { useState } from "react";
import type { ReviewerStop } from "@preztiaos/contracts";
import { Badge, Banner, Button, Input, Modal, MoneyText, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCancelRouteStop, useRouteDetail } from "../api/queries";

const MIN_REASON_LENGTH = 3;

/** Detalle de la ruta: cada parada con su cobrador, estado, resultado y (si está abierta) cancelar. */
export function RouteDetailModal({ routeId, onClose }: { routeId: string | null; onClose: () => void }) {
  const { t } = useT();
  const detail = useRouteDetail(routeId);
  return (
    <Modal visible={routeId != null} onClose={onClose} title={t("route.detail.title")}>
      <Stack gap="sm" className="p-4">
        {detail.isPending ? <Spinner label={t("common.loading")} /> : null}
        {(detail.data?.stops ?? []).map((s) => (
          <StopRow key={s.id} stop={s} />
        ))}
      </Stack>
    </Modal>
  );
}

function StopRow({ stop }: { stop: ReviewerStop }) {
  const { t } = useT();
  const cancel = useCancelRouteStop();
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = stop.status === "ASSIGNED" || stop.status === "SEEN";
  return (
    <Stack gap="xs" className="border-b border-zinc-100 pb-2 dark:border-zinc-800">
      <Row className="items-center justify-between">
        <Text variant="label" className="flex-1 pr-2">
          {stop.sequence}. {stop.clientName}
        </Text>
        <Badge
          label={stop.outcome ? t(`route.outcome.${stop.outcome}`) : t(`route.status.${stop.status}`)}
          tone={stop.outcome === "PAID" ? "success" : open ? "warning" : "neutral"}
        />
      </Row>
      <Text variant="caption" tone="muted">
        {stop.collectorEmail ?? stop.collectorId}
        {stop.seenAt ? ` · ${t("route.detail.seen")} ${new Date(stop.seenAt).toLocaleString()}` : ""}
      </Text>
      <Row className="items-center justify-between">
        <Text variant="caption" tone="muted">
          {t("route.detail.toCollect")}
        </Text>
        <MoneyText variant="caption" amountMinor={stop.amountToCollectMinor} currency={stop.currency} />
      </Row>
      {stop.collectedMinor ? (
        <Row className="items-center justify-between">
          <Text variant="caption">{t("route.detail.collected")}</Text>
          <MoneyText variant="caption" amountMinor={stop.collectedMinor} currency={stop.currency} />
        </Row>
      ) : null}
      {[stop.outcomeReason, stop.promiseDate ? `${t("route.detail.promise")} ${stop.promiseDate}` : null, stop.note, stop.cancelReason]
        .filter(Boolean)
        .map((line) => (
          <Text key={line} variant="caption" tone="muted">
            {line}
          </Text>
        ))}
      {error ? <Banner tone="danger" title={error} /> : null}
      {open && !cancelling ? (
        <Button label={t("route.detail.cancel")} variant="ghost" size="sm" onPress={() => setCancelling(true)} />
      ) : null}
      {open && cancelling ? (
        <Stack gap="xs">
          <Input value={reason} onChangeText={setReason} placeholder={t("remittance.debt.reason")} />
          <Button
            label={t("route.detail.confirmCancel")}
            variant="danger"
            size="sm"
            loading={cancel.isPending}
            disabled={reason.trim().length < MIN_REASON_LENGTH}
            onPress={() =>
              cancel.mutate(
                { id: stop.id, reason: reason.trim() },
                { onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")) },
              )
            }
          />
        </Stack>
      ) : null}
    </Stack>
  );
}
