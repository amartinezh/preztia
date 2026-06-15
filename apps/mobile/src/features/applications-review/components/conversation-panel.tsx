import { ScrollView, View } from "react-native";
import { EmptyState, ErrorState, Modal, Spinner, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useApplicationConversation } from "../api/queries";

type Props = {
  applicationId: string;
  visible: boolean;
  onClose: () => void;
};

/**
 * Panel cerrable con TODA la conversación que el cliente tuvo con la plataforma desde el
 * inicio: qué preguntó (entrante) y qué se respondió (saliente), en orden cronológico. Se
 * carga de forma perezosa al abrir. Card responsivo, fácil de cerrar (backdrop / ✕).
 */
export function ConversationPanel({ applicationId, visible, onClose }: Props) {
  const { t } = useT();
  const query = useApplicationConversation(applicationId, visible);
  const entries = query.data?.entries ?? [];

  return (
    <Modal visible={visible} onClose={onClose} title={t("review.conversation.title")}>
      <View className="p-4">
        {query.isPending ? <Spinner label={t("common.loading")} /> : null}
        {query.isError ? (
          <ErrorState title={t("review.conversation.title")} description={t("errors.network")} onRetry={() => query.refetch()} />
        ) : null}
        {query.isSuccess && entries.length === 0 ? <EmptyState title={t("review.conversation.empty")} /> : null}
        {query.isSuccess && entries.length > 0 ? (
          <ScrollView className="max-h-[60vh]">
            <Stack gap="sm">
              {entries.map((entry, i) => {
                const inbound = entry.direction === "INBOUND";
                return (
                  <View
                    key={i}
                    className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                      inbound
                        ? "self-start bg-zinc-100 dark:bg-zinc-800"
                        : "self-end bg-brand-100 dark:bg-brand-950"
                    }`}
                  >
                    <Text variant="caption" tone="muted">
                      {inbound ? "Cliente" : "Plataforma"} · {entry.kind}
                    </Text>
                    <Text variant="body">
                      {entry.body ?? (entry.mimeType ? `[${entry.mimeType}]` : "[adjunto]")}
                    </Text>
                  </View>
                );
              })}
            </Stack>
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}
