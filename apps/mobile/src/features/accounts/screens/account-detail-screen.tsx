import { useEffect, useRef } from "react";
import { View } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { AccountDetail } from "@preztiaos/contracts";
import {
  Button,
  Card,
  ErrorState,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
  formatDate,
  formatMoney,
  formatShortDate,
  useToast,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useT, type MessageKey } from "@/core/i18n";
import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";
import { PaymentsList } from "@/features/payments/components/payments-list";
import { CollectionSection } from "@/features/collections/components/collection-section";
import { CollectionLogSection } from "@/features/collections/components/collection-log-section";
import { useAccountDetail } from "../api/queries";

type InstallmentStatus = AccountDetail["installments"][number]["status"];

// Color de la celda de cuota (espejo del cronograma con colores del legado).
const CELL_BG: Record<InstallmentStatus, string> = {
  PAID: "bg-emerald-200 dark:bg-emerald-900",
  OVERDUE: "bg-red-200 dark:bg-red-900",
  PARTIALLY_PAID: "bg-amber-200 dark:bg-amber-900",
  PENDING: "bg-zinc-100 dark:bg-zinc-800",
};
// Orden de la leyenda: como se lee un cronograma (pagado, parcial, vencido, lo que falta).
const LEGEND: readonly InstallmentStatus[] = ["PAID", "PARTIALLY_PAID", "OVERDUE", "PENDING"];
// El interés viaja en base mil (200 = 20 %).
const BASE_THOUSAND_TO_PERCENT = 10;

/**
 * ÚNICO detalle de crédito (rutas `/credit/:id` y `/account/:creditId`): cabecera (cliente, plan,
 * capital, cuota, abonos, deuda, atraso, fechas), cronograma por colores con leyenda, registrar
 * pago, gestión de cobro y bitácora (revisores) y abonos. `justGranted` llega tras otorgar/aprobar
 * y anuncia la cuota real que calculó el servidor.
 */
export function AccountDetailScreen({
  creditId,
  justGranted = false,
}: {
  creditId: string;
  justGranted?: boolean;
}) {
  const { t, tf, locale } = useT();
  const router = useRouter();
  const toast = useToast();
  const { role } = useSession();
  const query = useAccountDetail(creditId);
  const account = query.data;

  // "Crédito otorgado · cuota $X" una sola vez por llegada, con el dato del servidor (no el tecleado).
  const grantedAnnounced = useRef(false);
  useEffect(() => {
    if (!justGranted || !account || grantedAnnounced.current) return;
    grantedAnnounced.current = true;
    toast.show({
      tone: "success",
      title: t("credit.detail.granted"),
      description: tf("credit.detail.grantedInstallment", {
        amount: formatMoney(account.installmentValueMinor, account.currency),
      }),
    });
  }, [justGranted, account, toast, t, tf]);

  if (query.isPending) return <Spinner label={t("common.loading")} />;
  if (query.isError || !account) {
    return (
      <ErrorState
        title={t("credit.detail.title")}
        description={t("errors.network")}
        retryLabel={t("common.retry")}
        onRetry={() => query.refetch()}
      />
    );
  }

  const a = account;
  const interest = `${(a.interestPct / BASE_THOUSAND_TO_PERCENT).toFixed(1)}%`;
  const reviewer = can(role, "application:review");

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
            <KeyValue label={t("accounts.field.startDate")} value={formatDate(a.startDate, locale)} />
            <KeyValue label={t("accounts.field.endDate")} value={formatDate(a.endDate, locale)} />
          </Stack>
        </Card>

        {can(role, "payment:register") ? (
          <Button
            label={t("payments.register")}
            block
            onPress={() => router.push(`/payment/${creditId}` as Href)}
          />
        ) : null}

        <Stack gap="sm">
          <Text variant="heading">{t("accounts.detail.schedule")}</Text>
          <View className="flex-row flex-wrap gap-2">
            {a.installments.map((inst) => {
              const due = formatShortDate(inst.dueDate, locale);
              const statusLabel = t(`credit.installment.${inst.status}` as MessageKey);
              return (
                <View
                  key={inst.seq}
                  accessibilityLabel={`${inst.seq} · ${due} · ${statusLabel}`}
                  className={`w-[72px] items-center rounded-lg p-2 ${CELL_BG[inst.status]}`}
                >
                  <Text variant="label">{inst.seq}</Text>
                  <Text variant="caption" tone="muted">
                    {due}
                  </Text>
                </View>
              );
            })}
          </View>
          <View className="flex-row flex-wrap gap-3" accessibilityLabel={t("credit.detail.legend")}>
            {LEGEND.map((status) => (
              <Row key={status} gap="xs">
                <View className={`h-3 w-3 rounded-sm ${CELL_BG[status]}`} />
                <Text variant="caption" tone="muted">
                  {t(`credit.installment.${status}` as MessageKey)}
                </Text>
              </Row>
            ))}
          </View>
        </Stack>

        {reviewer ? <CollectionSection creditId={creditId} /> : null}

        {/* Historial de visitas y observaciones del cobrador (revisor: admin/coordinador). */}
        {reviewer ? <CollectionLogSection creditId={creditId} /> : null}

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
