import { useState } from "react";
import { useRouter, type Href } from "expo-router";
import type { DailyReport } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Card,
  ErrorState,
  formatMoney,
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
  if (query.isError || !query.data) {
    return (
      <ErrorState
        title={t("common.loadFailed")}
        description={t("common.loadFailedHint")}
        retryLabel={t("common.retry")}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const d = query.data;
  return (
    <Stack gap="sm">
      <Text variant="heading">{t("cash.treasury.title")}</Text>
      <Card>
        <Stack gap="sm">
          <Stack gap="xs">
            <Text tone="muted">{t("cash.boxes.liquidity")}</Text>
            <MoneyText variant="heading" amountMinor={d.treasury.availableMinor} currency={d.currency} />
            <Text variant="caption" tone="muted">
              {t("cash.treasury.availableHint")}
            </Text>
          </Stack>
          <Line label={t("cash.treasury.office")} amountMinor={d.treasury.officeMinor} currency={d.currency} />
          <Line label={t("cash.treasury.bank")} amountMinor={d.treasury.bankMinor} currency={d.currency} />
          <Line label={t("cash.treasury.route")} amountMinor={d.treasury.routeMinor} currency={d.currency} />
          {d.treasury.transitMinor > 0 ? (
            <Line label={t("cash.treasury.transit")} amountMinor={d.treasury.transitMinor} currency={d.currency} />
          ) : null}
          <Line label={t("cash.treasury.total")} amountMinor={d.treasury.totalMinor} currency={d.currency} />
          {d.treasury.transitMinor > 0 ? (
            <Banner
              tone="warning"
              title={t("cash.boxes.unidentified")}
              description={formatMoney(d.treasury.transitMinor, d.currency)}
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

/** Días que se pueden consultar del reporte diario: hoy y ayer (los más usados al cuadrar). */
type ReportDay = "today" | "yesterday";
const DAYS_AGO: Record<ReportDay, number> = { today: 0, yesterday: 1 };
const REPORT_DAYS: ReportDay[] = ["today", "yesterday"];

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Fecha de hace `daysAgo` días como YYYY-MM-DD en la hora LOCAL del dispositivo (no UTC). */
function localDateDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "martes, 3 de noviembre" a partir de YYYY-MM-DD, interpretado como fecha local (sin desfase UTC). */
function readableDate(isoDate: string, locale: string): string {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * Reporte diario con la fecha visible y elegible (hoy / ayer). La fecha se calcula en el cliente
 * con la hora local del dispositivo y viaja al servidor, así el "hoy" es el del operador.
 */
function DailyReportCard() {
  const { t, tf, locale } = useT();
  const [day, setDay] = useState<ReportDay>("today");
  const date = localDateDaysAgo(DAYS_AGO[day]);
  const query = useDailyReport(date);

  return (
    <Card>
      <Stack gap="xs">
        <Row className="items-center justify-between">
          <Text variant="heading">{t("cash.daily.title")}</Text>
          <Row className="gap-2">
            {REPORT_DAYS.map((key) => (
              <Button
                key={key}
                label={t(`common.${key}`)}
                size="sm"
                variant={day === key ? "primary" : "secondary"}
                onPress={() => setDay(key)}
              />
            ))}
          </Row>
        </Row>
        <Text variant="caption" tone="muted">
          {tf("cash.report.of", { date: readableDate(date, locale) })}
        </Text>
        {query.isPending ? <Spinner label={t("common.loading")} /> : null}
        {query.isError ? (
          <ErrorState
            title={t("common.loadFailed")}
            description={t("common.loadFailedHint")}
            retryLabel={t("common.retry")}
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {query.data ? <DailyReportLines report={query.data} /> : null}
      </Stack>
    </Card>
  );
}

function DailyReportLines({ report: r }: { report: DailyReport }) {
  const { t } = useT();
  return (
    <>
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
    </>
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
      <ExpenseRequestForm currency={currency} />
      <ExpensesPanel mode={canManage ? "review" : "mine"} currency={currency} />
    </Stack>
  );
}
