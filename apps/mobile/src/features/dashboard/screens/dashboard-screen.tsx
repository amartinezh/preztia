import { useState } from "react";
import { View } from "react-native";
import { Banner, Card, formatMoney, Row, Spinner, Stack, Text, useTheme } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useT, type MessageKey } from "@/core/i18n";
import { useDashboardKpis } from "../api/queries";
import { BarChart } from "../components/bar-chart";
import { DonutChart } from "../components/donut-chart";
import { KpiCard } from "../components/kpi-card";
import { dashboardPalette } from "../components/palette";
import { PeriodToggle, type PeriodOption } from "../components/period-toggle";
import { SectionHeader } from "../components/section-header";
import { StageTimeline } from "../components/stage-timeline";

// Ventanas de calendario acumuladas para la trazabilidad de tiempos (clave del DTO del backend).
type TimePeriod = "today" | "week" | "month" | "year";

/**
 * Dashboard inicial de KPIs: panel de bienvenida que consolida en una sola vista (con scroll)
 * las métricas financieras, de conversión de solicitudes y de riesgo/fraude del tenant. Orquesta
 * datos (hook) y los reparte a tarjetas/gráficos puros; el estilo se apoya en los tokens del tema.
 */
export function DashboardScreen() {
  const { t } = useT();
  const { colors } = useTheme();
  const query = useDashboardKpis();
  const kpis = query.data;

  // Ventana temporal seleccionada para la trazabilidad de tiempos de atención. El backend ya
  // entrega las cuatro ventanas, así que cambiar de periodo no dispara refetch (solo re-render).
  const [period, setPeriod] = useState<TimePeriod>("today");
  const periodOptions: readonly PeriodOption<TimePeriod>[] = [
    { key: "today", label: t("home.timings.period.today") },
    { key: "week", label: t("home.timings.period.week") },
    { key: "month", label: t("home.timings.period.month") },
    { key: "year", label: t("home.timings.period.year") },
  ];

  // Colores derivados del tema para pasar a los componentes SVG (que no leen nativewind).
  const textColor = colors.text;
  const muted = "#94a3b8"; // gris neutro legible sobre fondo claro u oscuro
  const track = colors.surfaceMuted;
  const surface = colors.surface;
  const border = colors.border;

  const money = (amountMinor: number) => formatMoney(amountMinor, kpis?.currency ?? "COP");

  return (
    <Screen>
      <Stack gap="lg">
        {/* Hero de bienvenida */}
        <Stack gap="xs">
          <Text variant="caption" style={{ color: muted }}>
            {greeting(t)}
          </Text>
          <Text variant="title" style={{ color: textColor }}>
            {t("home.title")}
          </Text>
          <Text variant="caption" style={{ color: muted }}>
            {today()}
          </Text>
        </Stack>

        {query.isError && !kpis ? <Banner tone="danger" title={t("errors.network")} /> : null}
        {query.isPending && !kpis ? <Spinner label={t("common.loading")} /> : null}

        {kpis ? (
          <Stack gap="lg">
            {/* ── Bloque Financiero ─────────────────────────────────────────── */}
            <Stack gap="md">
              <SectionHeader
                icon="💰"
                title={t("home.treasury.title")}
                subtitle={t("home.treasury.subtitle")}
                accent={dashboardPalette.indigo}
                textColor={textColor}
                mutedColor={muted}
              />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <KpiCard
                  icon="🏦"
                  label={t("home.treasury.cash")}
                  value={money(kpis.treasury.cashAvailableMinor)}
                  accent={dashboardPalette.emerald}
                  textColor={textColor}
                  mutedColor={muted}
                  surfaceColor={surface}
                  borderColor={border}
                />
                <KpiCard
                  icon="📊"
                  label={t("home.treasury.active")}
                  value={money(kpis.treasury.portfolioActiveMinor)}
                  accent={dashboardPalette.violet}
                  textColor={textColor}
                  mutedColor={muted}
                  surfaceColor={surface}
                  borderColor={border}
                />
                <KpiCard
                  icon="⚠️"
                  label={t("home.treasury.overdue")}
                  value={money(kpis.treasury.portfolioOverdueMinor)}
                  caption={overdueRate(kpis.treasury.portfolioActiveMinor, kpis.treasury.portfolioOverdueMinor)}
                  accent={dashboardPalette.rose}
                  textColor={textColor}
                  mutedColor={muted}
                  surfaceColor={surface}
                  borderColor={border}
                />
              </View>
              <Card>
                <Stack gap="sm">
                  <Text variant="label" style={{ color: textColor }}>
                    {t("home.treasury.chart")}
                  </Text>
                  <BarChart
                    height={210}
                    textColor={textColor}
                    mutedColor={muted}
                    data={[
                      {
                        label: t("home.treasury.cashShort"),
                        value: kpis.treasury.cashAvailableMinor,
                        display: compactMoney(kpis.treasury.cashAvailableMinor, kpis.currency),
                        color: dashboardPalette.emerald,
                      },
                      {
                        label: t("home.treasury.activeShort"),
                        value: kpis.treasury.portfolioActiveMinor,
                        display: compactMoney(kpis.treasury.portfolioActiveMinor, kpis.currency),
                        color: dashboardPalette.violet,
                      },
                      {
                        label: t("home.treasury.overdueShort"),
                        value: kpis.treasury.portfolioOverdueMinor,
                        display: compactMoney(kpis.treasury.portfolioOverdueMinor, kpis.currency),
                        color: dashboardPalette.rose,
                      },
                    ]}
                  />
                </Stack>
              </Card>
            </Stack>

            {/* ── Bloque Solicitudes de Crédito ─────────────────────────────── */}
            <Stack gap="md">
              <SectionHeader
                icon="📝"
                title={t("home.applications.title")}
                subtitle={t("home.applications.subtitle")}
                accent={dashboardPalette.sky}
                textColor={textColor}
                mutedColor={muted}
              />
              <Card>
                <DonutChart
                  centerLabel={String(
                    kpis.applications.approved + kpis.applications.inProgress + kpis.applications.rejected,
                  )}
                  centerCaption={t("home.applications.total")}
                  trackColor={track}
                  textColor={textColor}
                  mutedColor={muted}
                  slices={[
                    {
                      label: t("home.applications.approved"),
                      value: kpis.applications.approved,
                      color: dashboardPalette.emerald,
                    },
                    {
                      label: t("home.applications.inProgress"),
                      value: kpis.applications.inProgress,
                      color: dashboardPalette.amber,
                    },
                    {
                      label: t("home.applications.rejected"),
                      value: kpis.applications.rejected,
                      color: dashboardPalette.rose,
                    },
                  ]}
                />
              </Card>

              {/* Trazabilidad de tiempos de atención: revela dónde se concentra la demora. */}
              <Card>
                <Stack gap="md">
                  <Stack gap="xs">
                    <Text variant="label" style={{ color: textColor }}>
                      {t("home.timings.title")}
                    </Text>
                    <Text variant="caption" style={{ color: muted }}>
                      {t("home.timings.subtitle")}
                    </Text>
                  </Stack>

                  <PeriodToggle
                    options={periodOptions}
                    value={period}
                    onChange={setPeriod}
                    accent={dashboardPalette.sky}
                    textColor={textColor}
                    mutedColor={muted}
                    trackColor={track}
                  />

                  {/* Titulares del periodo: tiempo extremo a extremo y solicitudes resueltas. */}
                  <Row className="items-center gap-3">
                    <View style={{ flex: 1 }}>
                      <Text variant="caption" style={{ color: muted }}>
                        {t("home.timings.total")}
                      </Text>
                      <Text variant="heading" style={{ color: textColor }}>
                        {formatDuration(kpis.applicationTimings[period].avgTotalMinutes, t)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="caption" style={{ color: muted }}>
                        {t("home.timings.resolved")}
                      </Text>
                      <Text variant="heading" style={{ color: textColor }}>
                        {String(kpis.applicationTimings[period].decidedCount)}
                      </Text>
                    </View>
                  </Row>

                  <StageTimeline
                    textColor={textColor}
                    mutedColor={muted}
                    trackColor={track}
                    emptyLabel={t("home.timings.empty")}
                    stages={[
                      {
                        label: t("home.timings.stage.intake"),
                        minutes: kpis.applicationTimings[period].avgIntakeMinutes ?? 0,
                        display: formatDuration(kpis.applicationTimings[period].avgIntakeMinutes, t),
                        color: dashboardPalette.sky,
                      },
                      {
                        label: t("home.timings.stage.review"),
                        minutes: kpis.applicationTimings[period].avgReviewMinutes ?? 0,
                        display: formatDuration(kpis.applicationTimings[period].avgReviewMinutes, t),
                        color: dashboardPalette.amber,
                      },
                    ]}
                  />
                </Stack>
              </Card>
            </Stack>

            {/* ── Bloque Seguridad y Control (Riesgo + Fraude) ──────────────── */}
            <Stack gap="md">
              <SectionHeader
                icon="🛡️"
                title={t("home.risk.title")}
                subtitle={t("home.risk.subtitle")}
                accent={dashboardPalette.amber}
                textColor={textColor}
                mutedColor={muted}
              />
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                <KpiCard
                  icon="📤"
                  label={t("home.risk.uploads")}
                  value={String(kpis.risk.documentUploadAttempts)}
                  accent={dashboardPalette.sky}
                  textColor={textColor}
                  mutedColor={muted}
                  surfaceColor={surface}
                  borderColor={border}
                />
                <KpiCard
                  icon="🚨"
                  label={t("home.risk.fraud")}
                  value={String(kpis.risk.fraudAttemptsDetected)}
                  caption={fraudRate(kpis.risk.documentUploadAttempts, kpis.risk.fraudAttemptsDetected)}
                  accent={dashboardPalette.rose}
                  textColor={textColor}
                  mutedColor={muted}
                  surfaceColor={surface}
                  borderColor={border}
                />
              </View>
              <Card>
                <Stack gap="sm">
                  <Text variant="label" style={{ color: textColor }}>
                    {t("home.risk.chart")}
                  </Text>
                  <BarChart
                    height={190}
                    textColor={textColor}
                    mutedColor={muted}
                    data={[
                      {
                        label: t("home.risk.uploadsShort"),
                        value: kpis.risk.documentUploadAttempts,
                        color: dashboardPalette.sky,
                      },
                      {
                        label: t("home.risk.fraudShort"),
                        value: kpis.risk.fraudAttemptsDetected,
                        color: dashboardPalette.rose,
                      },
                    ]}
                  />
                </Stack>
              </Card>
            </Stack>
          </Stack>
        ) : null}
      </Stack>
    </Screen>
  );
}

// --- Helpers de presentación (sin lógica de negocio) --------------------------

function greeting(t: (key: MessageKey) => string): string {
  const hour = new Date().getHours();
  if (hour < 12) return t("home.greeting.morning");
  if (hour < 19) return t("home.greeting.afternoon");
  return t("home.greeting.evening");
}

function today(): string {
  return new Date().toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Porcentaje de cartera vencida sobre la activa (mora), como leyenda de alerta. */
function overdueRate(activeMinor: number, overdueMinor: number): string | undefined {
  const base = activeMinor + overdueMinor;
  if (base <= 0) return undefined;
  return `${Math.round((overdueMinor / base) * 100)}% en mora`;
}

/** Porcentaje de intentos de subida marcados como fraude. */
function fraudRate(uploads: number, fraud: number): string | undefined {
  if (uploads <= 0) return undefined;
  return `${Math.round((fraud / uploads) * 100)}% del total`;
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

/**
 * Formatea una duración media (en minutos) a una escala legible según su magnitud: minutos para
 * lo corto, horas + minutos para lo intermedio, días + horas para lo largo (promedios anuales).
 * `null` (periodo sin datos para ese tramo) se muestra como guion.
 */
function formatDuration(minutes: number | null, t: (key: MessageKey) => string): string {
  if (minutes === null) return "—";
  if (minutes < 1) return `<1 ${t("home.timings.unit.min")}`;
  if (minutes < MINUTES_PER_HOUR) return `${Math.round(minutes)} ${t("home.timings.unit.min")}`;
  if (minutes < MINUTES_PER_DAY) {
    const hours = Math.floor(minutes / MINUTES_PER_HOUR);
    const rest = Math.round(minutes % MINUTES_PER_HOUR);
    return rest > 0
      ? `${hours} ${t("home.timings.unit.hour")} ${rest} ${t("home.timings.unit.min")}`
      : `${hours} ${t("home.timings.unit.hour")}`;
  }
  const days = Math.floor(minutes / MINUTES_PER_DAY);
  const hours = Math.round((minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  return hours > 0
    ? `${days} ${t("home.timings.unit.day")} ${hours} ${t("home.timings.unit.hour")}`
    : `${days} ${t("home.timings.unit.day")}`;
}

const THOUSANDS = 1000;
const MILLIONS = 1_000_000;

/** Etiqueta compacta de dinero para encima de las barras (evita números largos). */
function compactMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  if (major >= MILLIONS) return `${currency} ${(major / MILLIONS).toFixed(1)}M`;
  if (major >= THOUSANDS) return `${currency} ${Math.round(major / THOUSANDS)}K`;
  return `${currency} ${Math.round(major)}`;
}
