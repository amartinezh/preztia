import { Pressable, View } from "react-native";
import type { ConversationSummary } from "@preztiaos/contracts";
import { Badge, Checkbox, Row, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { formatTimestamp } from "./conversation-history";
import { outcomeLabelKey, outcomeTone } from "./outcome";

type Props = {
  item: ConversationSummary;
  /** Modo selección activo: muestra la casilla y permite marcar la fila. */
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
};

/**
 * Fila de la bandeja: identifica al cliente, resume su actividad y muestra el desenlace. En modo
 * selección antepone la casilla; las conversaciones protegidas (crédito aprobado) no se marcan.
 */
export function ConversationRow({ item, selectable, selected, onToggle, onOpen }: Props) {
  const { t } = useT();
  const preview = item.lastBody ?? `[${item.lastKind}]`;
  const traffic = `${item.messageCount} msg (${item.inboundCount}↓/${item.outboundCount}↑)`;

  return (
    <Row
      gap="sm"
      className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {selectable ? (
        <Checkbox
          value={selected}
          onValueChange={onToggle}
          disabled={item.protected}
          accessibilityLabel={`${t("inbox.select")} ${item.applicantPhoneMasked}`}
        />
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        className="flex-1 active:opacity-70 web:transition-opacity"
      >
        <View className="gap-0.5">
          <Row className="justify-between gap-2">
            <Text variant="label" className="text-base">
              {item.applicantPhoneMasked}
            </Text>
            <Text variant="caption" tone="muted">
              {formatTimestamp(item.lastAt)}
            </Text>
          </Row>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {preview}
          </Text>
          <Text variant="caption" tone="muted">
            {traffic} · {item.zonePath ?? "—"}
          </Text>
        </View>
      </Pressable>

      <Stack gap="xs" className="items-end">
        <Badge label={t(outcomeLabelKey(item.outcome))} tone={outcomeTone(item.outcome)} />
        {item.failureCount > 0 ? (
          <Text variant="caption" tone="danger">
            ⚠ {item.failureCount}
          </Text>
        ) : null}
        {item.protected ? (
          <Text variant="caption" tone="muted">
            🔒 {t("inbox.protected")}
          </Text>
        ) : null}
      </Stack>
    </Row>
  );
}
