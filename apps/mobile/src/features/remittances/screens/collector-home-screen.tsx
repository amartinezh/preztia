import { Button, Card, MoneyText, Row, Skeleton, Spinner, Stack, Text } from "@preztiaos/ui";
import { useRouter, type Href } from "expo-router";

import { Screen } from "@/components/screen";
import { useT } from "@/core/i18n";
import { MyRouteSection } from "@/features/collection-routes/components/my-route-section";
import { useCollectionToday } from "@/features/collections/api/today-queries";
import { TodaySummaryCard } from "@/features/collections/screens/collection-today-screen";
import { useMyRemittance } from "../api/queries";
import { ObligationBadge } from "../components/remittance-parts";

/**
 * INICIO del COBRADOR: solo lo suyo — cómo va su cobro de hoy (cobrado vs esperado, pendientes) con
 * acceso directo a cobrar, si debe rendir (y su atraso), el efectivo en su poder, su deuda
 * arrastrada y las paradas de su ruta. Nunca las cifras de la empresa (esas son del panel de
 * ADMIN/COORDINATOR): el cobrador no debe dimensionar el negocio.
 */
export function CollectorHomeScreen() {
  const { t } = useT();
  const router = useRouter();
  const mine = useMyRemittance();
  const today = useCollectionToday({ status: "PENDING" });
  const data = mine.data;
  const first = today.data?.pages[0];

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("home.collector.title")}</Text>

        {first ? (
          <Stack gap="sm">
            <TodaySummaryCard summary={first.summary} currency={first.currency} />
            <Button label={t("today.goCollect")} block onPress={() => router.push("/cuentas" as Href)} />
          </Stack>
        ) : today.isPending ? (
          <Skeleton className="h-28 w-full rounded-2xl" />
        ) : null}

        {mine.isPending ? <Spinner label={t("common.loading")} /> : null}
        {data?.hasRouteBox ? (
          <Card>
            <Stack gap="sm">
              <ObligationBadge status={data.status} lateMinutes={data.lateMinutes} dueAt={data.dueAt} />
              <Row className="items-center justify-between">
                <Text variant="label">{t("remittance.cashInHand")}</Text>
                <MoneyText variant="heading" amountMinor={data.cashInHandMinor} currency={data.currency} />
              </Row>
              {data.carriedDebtMinor > 0 ? (
                <Row className="items-center justify-between">
                  <Text variant="label" tone="danger">
                    {t("remittance.carriedDebt")}
                  </Text>
                  <MoneyText variant="label" amountMinor={data.carriedDebtMinor} currency={data.currency} />
                </Row>
              ) : null}
            </Stack>
          </Card>
        ) : null}
        <MyRouteSection />
      </Stack>
    </Screen>
  );
}
