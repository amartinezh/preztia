import { View } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { BadgeTone } from "@preztiaos/ui";
import { Badge, Button, Card, ErrorState, MoneyText, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";
import { useT } from "@/core/i18n";
import { PaymentsList } from "@/features/payments/components/payments-list";
import { CollectionSection } from "@/features/collections/components/collection-section";
import { CollectionLogSection } from "@/features/collections/components/collection-log-section";
import { useCreditPortfolio } from "../api/queries";

type InstallmentStatus = "PENDING" | "PARTIALLY_PAID" | "PAID" | "OVERDUE";

function installmentBadge(status: InstallmentStatus): { tone: BadgeTone; label: string } {
  switch (status) {
    case "PENDING":
      return { tone: "neutral", label: "Pendiente" };
    case "PARTIALLY_PAID":
      return { tone: "warning", label: "Parcial" };
    case "PAID":
      return { tone: "success", label: "Pagada" };
    case "OVERDUE":
      return { tone: "danger", label: "Vencida" };
  }
}

export function CreditPortfolioScreen({ creditId }: { creditId: string }) {
  const { t } = useT();
  const router = useRouter();
  const { role } = useSession();
  const query = useCreditPortfolio(creditId);

  if (query.isPending) return <Spinner label={t("common.loading")} />;
  if (query.isError) {
    return <ErrorState title={t("credit.portfolio.balance")} description={t("errors.network")} onRetry={() => query.refetch()} />;
  }

  const { balanceMinor, currency, installments } = query.data;

  return (
    <Screen>
      <Stack gap="lg">
        <Card>
          <Stack gap="xs">
            <Text variant="label" tone="muted">
              {t("credit.portfolio.balance")}
            </Text>
            <MoneyText variant="title" amountMinor={balanceMinor} currency={currency} />
          </Stack>
        </Card>

        {can(role, "payment:register") ? (
          <Button label={t("payments.register")} block onPress={() => router.push(`/payment/${creditId}` as Href)} />
        ) : null}

        {can(role, "application:review") ? <CollectionSection creditId={creditId} /> : null}

        {/* Historial de visitas y observaciones del cobrador (revisor: admin/coordinador). */}
        {can(role, "application:review") ? <CollectionLogSection creditId={creditId} /> : null}

        <Stack gap="sm">
          <Text variant="heading">{t("credit.portfolio.installments")}</Text>
          {installments.map((inst) => {
            const badge = installmentBadge(inst.status);
            return (
              <Card key={inst.seq}>
                <Row className="justify-between">
                  <Stack gap="xs">
                    <Text variant="label">#{inst.seq} · {inst.dueDate}</Text>
                    <View className="flex-row gap-2">
                      <MoneyText variant="caption" tone="muted" amountMinor={inst.paidMinor} currency={currency} />
                      <Text variant="caption" tone="muted">/</Text>
                      <MoneyText variant="caption" tone="muted" amountMinor={inst.amountDueMinor} currency={currency} />
                    </View>
                  </Stack>
                  <Badge tone={badge.tone} label={badge.label} />
                </Row>
              </Card>
            );
          })}
        </Stack>

        <Stack gap="sm">
          <Text variant="heading">{t("payments.title")}</Text>
          <PaymentsList creditId={creditId} />
        </Stack>
      </Stack>
    </Screen>
  );
}
