import { Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useConversationThread } from "../api/queries";

/**
 * Historial de conversación de WhatsApp con un cliente, renderizado como hilo de chat continuo:
 * los mensajes ENTRANTES (lo que el cliente envía, incluidas fotos del comprobante) a la izquierda
 * y los SALIENTES (recordatorios de cobro automáticos y manuales) a la derecha. Lee el transcript
 * append-only `conversation_message` por teléfono (scopeado por zona en el servidor). Reutilizable
 * en el detalle del crédito/cliente y en la bandeja.
 */
export function ConversationHistory({ phone }: { phone: string | null }) {
  const { t } = useT();
  const query = useConversationThread(phone);

  if (phone === null) return null;
  if (query.isPending || !query.data) return <Spinner label={t("common.loading")} />;
  if (query.data.entries.length === 0) {
    return <Text tone="muted">{t("inbox.empty")}</Text>;
  }

  return (
    <Stack gap="xs">
      {query.data.entries.map((entry, i) => {
        const inbound = entry.direction === "INBOUND";
        return (
          <Row key={i} className={inbound ? "justify-start" : "justify-end"}>
            <Text variant="caption" tone={inbound ? "default" : "primary"}>
              {inbound ? "← " : "→ "}
              {entry.body ?? `[${entry.kind}]`}
            </Text>
          </Row>
        );
      })}
    </Stack>
  );
}
