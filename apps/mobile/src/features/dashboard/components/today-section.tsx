import { View } from "react-native";
import type { DashboardToday } from "@preztiaos/contracts";
import { formatMoney, Stack, Text } from "@preztiaos/ui";

import { KpiCard } from "./kpi-card";
import { dashboardPalette } from "./palette";

type Labels = {
  /** "Hoy · lunes, 8 de noviembre". */
  title: string;
  /** Línea secundaria opcional (vencido que se arrastra de días anteriores). */
  subtitle?: string;
  collected: string;
  expected: string;
  /** Leyenda bajo "Esperado hoy" (porcentaje cobrado); ausente cuando no hay nada esperado. */
  collectedPct?: string;
  lent: string;
  expenses: string;
  cashTitle: string;
  cashOffice: string;
  cashRoute: string;
  bank: string;
};

interface TodaySectionProps {
  today: DashboardToday;
  currency: string;
  labels: Labels;
  textColor: string;
  mutedColor: string;
  surfaceColor: string;
  borderColor: string;
}

const CARD_GAP = 12;

/**
 * Fila "Hoy": cómo va el negocio en el día de la empresa (cobrado vs. esperado, prestado, gastos)
 * y dónde está el efectivo (oficina, en ruta, bancos). Presentación pura: recibe cifras ya
 * calculadas en el servidor (zona horaria del tenant) y textos traducidos.
 */
export function TodaySection({
  today,
  currency,
  labels,
  textColor,
  mutedColor,
  surfaceColor,
  borderColor,
}: TodaySectionProps) {
  const money = (amountMinor: number) => formatMoney(amountMinor, currency);
  const cardColors = { textColor, mutedColor, surfaceColor, borderColor };

  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Text variant="heading" style={{ color: textColor }}>
          {labels.title}
        </Text>
        {labels.subtitle ? (
          <Text variant="caption" style={{ color: mutedColor }}>
            {labels.subtitle}
          </Text>
        ) : null}
      </Stack>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: CARD_GAP }}>
        <KpiCard label={labels.collected} value={money(today.collectedMinor)} accent={dashboardPalette.emerald} {...cardColors} />
        <KpiCard
          label={labels.expected}
          value={money(today.expectedTodayMinor)}
          caption={labels.collectedPct}
          accent={dashboardPalette.sky}
          {...cardColors}
        />
        <KpiCard label={labels.lent} value={money(today.lentMinor)} accent={dashboardPalette.violet} {...cardColors} />
        <KpiCard label={labels.expenses} value={money(today.expensesMinor)} accent={dashboardPalette.amber} {...cardColors} />
      </View>
      <Text variant="label" style={{ color: mutedColor }}>
        {labels.cashTitle}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: CARD_GAP }}>
        <KpiCard label={labels.cashOffice} value={money(today.cashOfficeMinor)} accent={dashboardPalette.indigo} {...cardColors} />
        <KpiCard label={labels.cashRoute} value={money(today.cashRouteMinor)} accent={dashboardPalette.amber} {...cardColors} />
        <KpiCard label={labels.bank} value={money(today.bankMinor)} accent={dashboardPalette.slate} {...cardColors} />
      </View>
    </Stack>
  );
}
