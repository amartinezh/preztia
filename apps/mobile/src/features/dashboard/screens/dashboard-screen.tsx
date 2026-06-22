import { View } from "react-native";
import { Banner, Card, formatMoney, Spinner, Stack, Text, useTheme } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useT, type MessageKey } from "@/core/i18n";
import { useDashboardKpis } from "../api/queries";
import { BarChart } from "../components/bar-chart";
import { DonutChart } from "../components/donut-chart";
import { KpiCard } from "../components/kpi-card";
import { dashboardPalette } from "../components/palette";
import { SectionHeader } from "../components/section-header";

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

const THOUSANDS = 1000;
const MILLIONS = 1_000_000;

/** Etiqueta compacta de dinero para encima de las barras (evita números largos). */
function compactMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  if (major >= MILLIONS) return `${currency} ${(major / MILLIONS).toFixed(1)}M`;
  if (major >= THOUSANDS) return `${currency} ${Math.round(major / THOUSANDS)}K`;
  return `${currency} ${Math.round(major)}`;
}
