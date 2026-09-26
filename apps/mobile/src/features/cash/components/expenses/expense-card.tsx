import type { Expense } from "@preztiaos/contracts";
import { Badge, Button, Card, MoneyText, Row, Stack, Text, type BadgeTone } from "@preztiaos/ui";

import { useT } from "@/core/i18n";

const STATUS_TONE: Record<Expense["status"], BadgeTone> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

/**
 * Un gasto con su trazabilidad: estado, fechas, motivo de rechazo y comprobante. En la bandeja del
 * revisor muestra además quién lo pidió y su zona, y el botón de revisión.
 */
export function ExpenseCard({
  expense,
  currency,
  showRequester,
  onViewReceipt,
  onReview,
}: {
  expense: Expense;
  currency: string;
  showRequester: boolean;
  onViewReceipt: () => void;
  onReview?: () => void;
}) {
  const { t } = useT();
  return (
    <Card>
      <Stack gap="xs">
        <Row className="items-center justify-between">
          <Text variant="label" className="flex-1 pr-2">
            {expense.description}
          </Text>
          <MoneyText variant="label" amountMinor={expense.amountMinor} currency={currency} />
        </Row>
        <Row className="items-center justify-between">
          <Badge label={t(`cash.status.${expense.status}`)} tone={STATUS_TONE[expense.status]} />
          <Text variant="caption" tone="muted">
            {new Date(expense.createdAt).toLocaleString()}
          </Text>
        </Row>
        {showRequester ? (
          <Text variant="caption" tone="muted">
            {expense.requesterEmail ?? expense.requestedBy}
            {expense.zoneName ? ` · ${expense.zoneName}` : ` · ${t("cash.boxes.zone.tenant")}`}
          </Text>
        ) : null}
        {expense.reviewedAt ? (
          <Text variant="caption" tone="muted">
            {t("cash.expenses.reviewedAt")} {new Date(expense.reviewedAt).toLocaleString()}
          </Text>
        ) : null}
        {expense.rejectionReason ? (
          <Text variant="caption" tone="danger">
            {t("cash.expenses.rejectionReason")}: {expense.rejectionReason}
          </Text>
        ) : null}
        <Row gap="sm" className="flex-wrap">
          {expense.hasReceipt ? (
            <Button label={t("cash.expenses.viewReceipt")} variant="ghost" size="sm" onPress={onViewReceipt} />
          ) : null}
          {onReview && expense.status === "PENDING" ? (
            <Button label={t("cash.expenses.review")} size="sm" onPress={onReview} />
          ) : null}
        </Row>
      </Stack>
    </Card>
  );
}
