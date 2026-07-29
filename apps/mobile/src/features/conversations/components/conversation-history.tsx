import { useMemo } from "react";
import { View } from "react-native";
import type { ConversationThreadOutput } from "@preztiaos/contracts";
import { Spinner, Stack, Text } from "@preztiaos/ui";

import { useT, type MessageKey } from "@/core/i18n";
import { useConversationThread } from "../api/queries";

/** Entrada del hilo ya normalizada: un mensaje del transcript o un fallo técnico. */
type ThreadEntry =
  | { kind: "message"; at: string; value: ConversationThreadOutput["entries"][number] }
  | { kind: "failure"; at: string; value: ConversationThreadOutput["failures"][number] };

/**
 * Historial de conversación de WhatsApp con un cliente, renderizado como hilo de chat continuo:
 * los mensajes ENTRANTES (lo que el cliente envía, incluidas fotos del comprobante) a la izquierda
 * y los SALIENTES (recordatorios de cobro automáticos y manuales) a la derecha. Lee el transcript
 * append-only `conversation_message` por teléfono (scopeado por zona en el servidor).
 *
 * Intercala en su lugar cronológico los mensajes que NO se pudieron atender: sin ellos el hilo
 * miente por omisión (se ve un cliente que "dejó de escribir" cuando en realidad se le cayó la
 * atención). Reutilizable en el detalle del crédito/cliente y en la bandeja.
 */
export function ConversationHistory({ phone }: { phone: string | null }) {
  const { t } = useT();
  const query = useConversationThread(phone);
  const entries = useMemo(() => interleave(query.data), [query.data]);

  if (phone === null) return null;
  if (query.isPending || !query.data) return <Spinner label={t("common.loading")} />;
  if (entries.length === 0) return <Text tone="muted">{t("inbox.empty")}</Text>;

  return (
    <Stack gap="sm">
      {entries.map((entry) =>
        entry.kind === "message" ? (
          <MessageBubble key={`m-${entry.at}`} entry={entry.value} />
        ) : (
          <FailureBubble key={`f-${entry.at}`} entry={entry.value} />
        ),
      )}
    </Stack>
  );
}

function MessageBubble({ entry }: { entry: ConversationThreadOutput["entries"][number] }) {
  const inbound = entry.direction === "INBOUND";
  return (
    <View
      className={`max-w-[85%] rounded-2xl px-3 py-2 ${
        inbound ? "self-start bg-zinc-100 dark:bg-zinc-800" : "self-end bg-brand-100 dark:bg-brand-950"
      }`}
    >
      <Text variant="caption" tone="muted">
        {entry.kind} · {formatTimestamp(entry.createdAt)}
      </Text>
      <Text variant="body">
        {entry.body ?? (entry.mimeType ? `[${entry.mimeType}]` : `[${entry.kind}]`)}
      </Text>
    </View>
  );
}

function FailureBubble({ entry }: { entry: ConversationThreadOutput["failures"][number] }) {
  const { t } = useT();
  return (
    <View className="max-w-[92%] self-center rounded-2xl border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950">
      <Text variant="caption" tone="danger">
        ⚠ {t("inbox.thread.failure")} ·{" "}
        {t(`inbox.failureStage.${entry.stage}` as MessageKey)} · {formatTimestamp(entry.createdAt)}
      </Text>
      <Text variant="caption" tone="muted">
        {entry.errorName}: {entry.errorMessage}
      </Text>
    </View>
  );
}

/** Une mensajes y fallos en una sola línea de tiempo ascendente. */
function interleave(data: ConversationThreadOutput | undefined): ThreadEntry[] {
  if (!data) return [];
  const entries: ThreadEntry[] = [
    ...data.entries.map((value) => ({ kind: "message" as const, at: value.createdAt, value })),
    ...data.failures.map((value) => ({ kind: "failure" as const, at: value.createdAt, value })),
  ];
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

/** Fecha y hora local, compacta: es el dato por el que la bandeja ordena por defecto. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
