import { Pressable, ScrollView, View } from "react-native";
import type { ConversationStatsOutput } from "@preztiaos/contracts";
import { Card, Row, Skeleton, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import {
  ALL_OUTCOMES,
  OUTCOME_FILTERS,
  outcomeHintKey,
  outcomeLabelKey,
  type OutcomeFilter,
} from "./outcome";

type Props = {
  stats: ConversationStatsOutput | undefined;
  loading: boolean;
  selected: OutcomeFilter;
  onSelect: (outcome: OutcomeFilter) => void;
};

// Realce de la categoría accionable por el equipo: si el sistema dejó gente a medias, tiene que
// verse antes que cualquier otro número de la pantalla.
const FAILURE_HIGHLIGHT = "border-red-300 dark:border-red-800";

/**
 * Cabecera analítica de la bandeja: el tráfico del rango consultado y el desglose por desenlace.
 * Cada categoría es además el filtro del listado, así que el número y la lista nunca divergen.
 */
export function ConversationStatsBar({ stats, loading, selected, onSelect }: Props) {
  const { t } = useT();

  if (loading && !stats) {
    return (
      <Row gap="sm">
        <Skeleton className="h-16 flex-1 rounded-2xl" />
        <Skeleton className="h-16 flex-1 rounded-2xl" />
        <Skeleton className="h-16 flex-1 rounded-2xl" />
      </Row>
    );
  }
  if (!stats) return null;

  return (
    <Stack gap="sm">
      <Row gap="sm">
        <Metric label={t("inbox.stats.conversations")} value={stats.totalConversations} />
        <Metric label={t("inbox.stats.messages")} value={stats.totalMessages} />
        <Metric
          label={t("inbox.stats.failures")}
          value={stats.failedMessages}
          tone={stats.failedMessages > 0 ? "danger" : "muted"}
        />
      </Row>
      <Row gap="sm">
        <Metric label={t("inbox.stats.inbound")} value={stats.inboundMessages} />
        <Metric label={t("inbox.stats.outbound")} value={stats.outboundMessages} />
      </Row>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Row gap="sm" className="py-1">
          {OUTCOME_FILTERS.map((outcome) => {
            const count =
              outcome === ALL_OUTCOMES
                ? stats.totalConversations
                : stats.byOutcome[outcome];
            const active = selected === outcome;
            return (
              <Pressable
                key={outcome}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(outcome)}
                className={`min-h-[44px] justify-center rounded-full border px-3 ${
                  active
                    ? "border-brand-600 bg-brand-50 dark:bg-zinc-800"
                    : outcome === "TECHNICAL_FAILURE" && count > 0
                      ? FAILURE_HIGHLIGHT
                      : "border-zinc-200 dark:border-zinc-700"
                }`}
              >
                <Text variant="label" tone={active ? "primary" : "muted"}>
                  {t(outcomeLabelKey(outcome))} · {count}
                </Text>
              </Pressable>
            );
          })}
        </Row>
      </ScrollView>

      <Text variant="caption" tone="muted">
        {t(outcomeHintKey(selected))}
      </Text>
    </Stack>
  );
}

function Metric({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: number;
  tone?: "muted" | "danger";
}) {
  return (
    <Card className="flex-1 p-3">
      <View className="gap-0.5">
        <Text variant="caption" tone={tone}>
          {label}
        </Text>
        <Text variant="heading" tone={tone === "danger" && value > 0 ? "danger" : "default"}>
          {value}
        </Text>
      </View>
    </Card>
  );
}
