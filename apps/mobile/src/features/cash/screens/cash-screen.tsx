import { useRouter, type Href } from "expo-router";
import {
  Banner,
  Button,
  Card,
  minorToMajor,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";
import { useT } from "@/core/i18n";
import { useDailyReport } from "../api/queries";
import { ExpenseRequestForm } from "../components/expenses/expense-request-form";
import { ExpensesPanel } from "../components/expenses/expenses-panel";
import { useCashDashboard } from "../api/boxes-queries";

/**
 * Resumen de Dinero / Tesorería: el dinero real al frente (liquidez del libro de cajas), seguido
 * del reporte diario (P&L de cartera) y los gastos (maker-checker). El detalle por caja (saldos,
 * arqueo, conciliación, movimientos) vive en el segmento "Cajas y cuentas" del hub Dinero.
 *
 * `embedded`: dentro del hub Dinero el encabezado propio sobra (el hub ya da título + segmentos);
 * `onOpenBoxes` cambia al segmento de cajas en lugar de navegar a la ruta suelta.
 */
export function CashScreen({
  embedded = false,
  onOpenBoxes,
}: {
  embedded?: boolean;
  onOpenBoxes?: () => void;
} = {}) {
  const { t } = useT();
  const router = useRouter();
  const { role } = useSession();
  const manages = can(role, "cash:manage");
  const openBoxes = onOpenBoxes ?? (() => router.push("/cash/boxes" as Href));

  return (
    <Screen>
      <Stack gap="lg">
        {embedded ? null : (
          <Row className="justify-between items-center">
            <Text variant="subtitle">{t("cash.title")}</Text>
            <Button label={t("cash.boxes.link")} variant="secondary" size="sm" onPress={openBoxes} />
          </Row>
        )}
        <TreasurySummaryCard onOpenBoxes={openBoxes} />
        <DailyReportCard />
        <ExpensesSection canManage={manages} />
      </Stack>
    </Screen>
  );
}

/**
 * Resumen de tesorería (fuente única = libro de cajas): liquidez total, efectivo y banco, y la
 * alerta de dinero en tránsito. Toca "Ver detalle" para ir a las cajas (arqueo, conciliación).
 */
function TreasurySummaryCard({ onOpenBoxes }: { onOpenBoxes: () => void }) {
  const { t } = useT();
  const query = useCashDashboard();
  if (query.isPending) return <Spinner label={t("common.loading")} />;
  if (query.isError || !query.data) return <Banner tone="danger" title={t("errors.network")} />;
  const d = query.data;
  return (
    <Stack gap="sm">
      <Text variant="heading">{t("cash.treasury.title")}</Text>
      <Card>
        <Stack gap="sm">
          <Stack gap="xs">
            <Text tone="muted">{t("cash.boxes.liquidity")}</Text>
            <MoneyText variant="heading" amountMinor={d.liquidityTotalMinor} currency={d.currency} />
          </Stack>
          <Line label={t("cash.boxes.cashCustody")} amountMinor={d.cashTotalMinor} currency={d.currency} />
          <Line label={t("cash.boxes.bankTotal")} amountMinor={d.bankTotalMinor} currency={d.currency} />
          {d.unidentifiedMinor > 0 ? (
            <Banner
              tone="warning"
              title={t("cash.boxes.unidentified")}
              description={`${minorToMajor(d.unidentifiedMinor)} ${d.currency}`}
            />
          ) : null}
          <Button label={t("cash.treasury.detail")} variant="secondary" size="sm" block onPress={onOpenBoxes} />
        </Stack>
      </Card>
    </Stack>
  );
}

function Line({ label, amountMinor, currency }: { label: string; amountMinor: number; currency: string }) {
  return (
    <Row className="justify-between">
      <Text tone="muted">{label}</Text>
      <MoneyText variant="label" amountMinor={amountMinor} currency={currency} />
    </Row>
  );
}

function DailyReportCard() {
  const { t } = useT();
  const query = useDailyReport();
  if (query.isPending) return <Spinner label={t("common.loading")} />;
  if (query.isError || !query.data) return <Banner tone="danger" title={t("errors.network")} />;
  const r = query.data;
  return (
    <Card>
      <Stack gap="xs">
        <Text variant="heading">{t("cash.daily.title")}</Text>
        <Line label={t("cash.field.collected")} amountMinor={r.totalCobradoMinor} currency={r.currency} />
        <Line label={t("cash.field.lent")} amountMinor={r.totalPrestadoMinor} currency={r.currency} />
        <Line label={t("cash.field.expenses")} amountMinor={r.gastosMinor} currency={r.currency} />
        <Line label={t("cash.field.cashOfDay")} amountMinor={r.cajaDelDiaMinor} currency={r.currency} />
        <Row className="justify-between">
          <Text tone="muted">{t("cash.daily.clients")}</Text>
          <Text variant="label">{r.clientsWithPayments}</Text>
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("cash.daily.pendingExpenses")}</Text>
          <Text variant="label">{r.pendingExpenses}</Text>
        </Row>
      </Stack>
    </Card>
  );
}

/**
 * Gastos en Dinero: solicitar (con comprobante) y, para ADMIN/COORDINATOR, la bandeja de revisión
 * dentro de su zona. El historial completo queda con fechas, motivos y comprobantes.
 */
function ExpensesSection({ canManage }: { canManage: boolean }) {
  const { t } = useT();
  const currency = useCashDashboard().data?.currency ?? "";
  return (
    <Stack gap="sm">
      <Text variant="heading">{t("cash.expenses.title")}</Text>
      <ExpenseRequestForm />
      <ExpensesPanel mode={canManage ? "review" : "mine"} currency={currency} />
    </Stack>
  );
}
