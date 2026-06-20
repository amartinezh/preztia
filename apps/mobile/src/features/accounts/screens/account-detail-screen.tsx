import { View } from "react-native";
import type { AccountDetail } from "@preztiaos/contracts";
import {
  Card,
  ErrorState,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useT } from "@/core/i18n";
import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";
import { PaymentsList } from "@/features/payments/components/payments-list";
import { CollectionSection } from "@/features/collections/components/collection-section";
import { useAccountDetail } from "../api/queries";

type InstallmentStatus = AccountDetail["installments"][number]["status"];

// Color de la celda de cuota (espejo del cronograma con colores del legado).
const CELL_BG: Record<InstallmentStatus, string> = {
  PAID: "bg-emerald-200 dark:bg-emerald-900",
  OVERDUE: "bg-red-200 dark:bg-red-900",
  PARTIALLY_PAID: "bg-amber-200 dark:bg-amber-900",
  PENDING: "bg-zinc-100 dark:bg-zinc-800",
};

/** Detalle de préstamo: cabecera (cupo, interés, valor cuota, deuda, atraso) + cronograma. */
export function AccountDetailScreen({ creditId }: { creditId: string }) {
  const { t } = useT();
  const { role } = useSession();
  const query = useAccountDetail(creditId);

  if (query.isPending) return <Spinner label={t("common.loading")} />;
  if (query.isError) {
    return (
      <ErrorState
        title={t("accounts.detail.title")}
        description={t("errors.network")}
        onRetry={() => query.refetch()}
      />
    );
  }

  const a = query.data;
  const interest = `${(a.interestPct / 10).toFixed(1)}%`;

  return (
    <Screen>
      <Stack gap="lg">
        <Card>
          <Stack gap="xs">
            <Text variant="heading">{a.borrowerName ?? a.nationalId ?? a.creditId.slice(0, 8)}</Text>
            <KeyValue label={t("accounts.field.nationalId")} value={a.nationalId ?? "—"} />
            <KeyValue label={t("accounts.field.phone")} value={a.phone ?? "—"} />
            <KeyValue label={t("accounts.field.plan")} value={a.planName ?? "—"} />
            <KeyMoney label={t("accounts.field.principal")} amountMinor={a.principalMinor} currency={a.currency} />
            <KeyValue label={t("accounts.field.installments")} value={String(a.installmentsCount)} />
            <KeyValue label={t("accounts.field.interest")} value={interest} />
            <KeyMoney label={t("accounts.field.installmentValue")} amountMinor={a.installmentValueMinor} currency={a.currency} />
            <KeyMoney label={t("accounts.field.paidTotal")} amountMinor={a.totalPaidMinor} currency={a.currency} />
            <KeyMoney label={t("accounts.field.debt")} amountMinor={a.outstandingMinor} currency={a.currency} />
            <KeyValue label={t("accounts.field.daysOverdue")} value={String(a.daysOverdue)} />
            <KeyValue label={t("accounts.field.startDate")} value={a.startDate} />
            <KeyValue label={t("accounts.field.endDate")} value={a.endDate} />
          </Stack>
        </Card>

        <Stack gap="sm">
          <Text variant="heading">{t("accounts.detail.schedule")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {a.installments.map((inst) => (
              <View
                key={inst.seq}
                className={`w-[72px] items-center rounded-lg p-2 ${CELL_BG[inst.status]}`}
              >
                <Text variant="label">{inst.seq}</Text>
                <Text variant="caption" tone="muted">
                  {inst.dueDate.slice(5)}
                </Text>
              </View>
            ))}
          </View>
        </Stack>

        {can(role, "application:review") ? <CollectionSection creditId={creditId} /> : null}

        <Stack gap="sm">
          <Text variant="heading">{t("accounts.detail.payments")}</Text>
          <PaymentsList creditId={creditId} />
        </Stack>
      </Stack>
    </Screen>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <Row className="justify-between">
      <Text tone="muted">{label}</Text>
      <Text variant="label">{value}</Text>
    </Row>
  );
}

function KeyMoney({
  label,
  amountMinor,
  currency,
}: {
  label: string;
  amountMinor: number;
  currency: string;
}) {
  return (
    <Row className="justify-between">
      <Text tone="muted">{label}</Text>
      <MoneyText variant="label" amountMinor={amountMinor} currency={currency} />
    </Row>
  );
}
