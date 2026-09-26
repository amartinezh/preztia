import type { DepositOrder, FieldOrderStatus } from "@preztiaos/contracts";
import { Badge, Button, Card, minorToMajor, MoneyText, Row, Stack, Text, type BadgeTone } from "@preztiaos/ui";

import { useT } from "@/core/i18n";

const STATUS_TONE: Record<FieldOrderStatus, BadgeTone> = {
  ISSUED: "warning",
  SEEN: "warning",
  REPORTED: "neutral",
  DISPUTED: "danger",
  VERIFIED: "success",
  CANCELLED: "neutral",
};

export interface DepositOrderActions {
  onThread: () => void;
  onReceipt: () => void;
  onReport?: () => void;
  onVerify?: () => void;
  onDispute?: () => void;
  onCancel?: () => void;
}

/**
 * Orden de consignación con su trazabilidad: cuánto y a qué cuenta se ordenó (con fecha y hora de
 * la solicitud), lo reportado y lo verificado. Las acciones disponibles dependen del estado y de
 * quién mira (el cobrador reporta; el revisor verifica, objeta o cancela).
 */
export function DepositOrderCard({
  order,
  showCollector,
  actions,
}: {
  order: DepositOrder;
  showCollector: boolean;
  actions: DepositOrderActions;
}) {
  const { t } = useT();
  const canReport = ["ISSUED", "SEEN", "DISPUTED"].includes(order.status);
  const canCancel = ["ISSUED", "SEEN", "DISPUTED"].includes(order.status);
  const reported = order.status === "REPORTED";
  return (
    <Card>
      <Stack gap="xs">
        <Row className="items-center justify-between">
          <Text variant="label" className="flex-1 pr-2">
            {t("deposit.orderTo")} {order.destinationName}
          </Text>
          <MoneyText variant="label" amountMinor={order.amountMinor} currency={order.currency} />
        </Row>
        <Row className="items-center justify-between">
          <Badge label={t(`deposit.status.${order.status}`)} tone={STATUS_TONE[order.status]} />
          <Text variant="caption" tone="muted">
            {t("deposit.issuedAt")} {new Date(order.issuedAt).toLocaleString()}
          </Text>
        </Row>
        {showCollector ? (
          <Text variant="caption" tone="muted">
            {order.collectorEmail ?? order.collectorId}
            {order.zoneName ? ` · ${order.zoneName}` : ""}
          </Text>
        ) : null}
        {order.instructions ? (
          <Text variant="caption" tone="muted">
            {order.instructions}
          </Text>
        ) : null}
        {order.reportedAmountMinor !== null && order.depositedAt ? (
          <Text variant="caption">
            {t("deposit.reported")}: {minorToMajor(order.reportedAmountMinor)} {order.currency} ·{" "}
            {new Date(order.depositedAt).toLocaleString()}
            {order.depositReference ? ` · ${order.depositReference}` : ""}
          </Text>
        ) : null}
        {order.verifiedAmountMinor !== null && order.verifiedAt ? (
          <Text variant="caption" tone="success">
            {t("deposit.verified")}: {minorToMajor(order.verifiedAmountMinor)} {order.currency} ·{" "}
            {new Date(order.verifiedAt).toLocaleString()}
            {order.bankCreditId ? ` · ${t("deposit.bankLinked")}` : ""}
          </Text>
        ) : null}
        <Row gap="sm" className="flex-wrap">
          <Button label={t("deposit.thread")} variant="ghost" size="sm" onPress={actions.onThread} />
          {order.hasReceipt ? (
            <Button label={t("cash.expenses.viewReceipt")} variant="ghost" size="sm" onPress={actions.onReceipt} />
          ) : null}
          {actions.onReport && canReport ? (
            <Button label={t("deposit.report.action")} size="sm" onPress={actions.onReport} />
          ) : null}
          {actions.onVerify && reported ? (
            <Button label={t("deposit.verify.action")} size="sm" onPress={actions.onVerify} />
          ) : null}
          {actions.onDispute && reported ? (
            <Button label={t("deposit.dispute.action")} variant="secondary" size="sm" onPress={actions.onDispute} />
          ) : null}
          {actions.onCancel && canCancel ? (
            <Button label={t("deposit.cancel.action")} variant="ghost" size="sm" onPress={actions.onCancel} />
          ) : null}
        </Row>
      </Stack>
    </Card>
  );
}
