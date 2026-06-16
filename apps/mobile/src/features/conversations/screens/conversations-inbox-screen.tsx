import { useMemo, useState } from "react";
import { FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ConversationSummary } from "@preztiaos/contracts";
import {
  Badge,
  Input,
  ListItem,
  Modal,
  Row,
  Spinner,
  Stack,
  Switch,
  Text,
  type BadgeTone,
} from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useConversationsList, useConversationThread } from "../api/queries";

const STATUS_TONE: Record<string, BadgeTone> = {
  AWAITING_DOCUMENTS: "warning",
  IN_REVIEW: "info",
  APPROVED: "success",
  REJECTED: "danger",
};

/** Bandeja de WhatsApp (vista 1): todas las comunicaciones del canal, scopeadas por zona. */
export function ConversationsInboxScreen() {
  const { t } = useT();
  const [search, setSearch] = useState("");
  const [withApplication, setWithApplication] = useState(false);
  const [thread, setThread] = useState<ConversationSummary | null>(null);

  const query = useConversationsList({
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(withApplication ? { withApplication: true } : {}),
  });
  const items = useMemo<ConversationSummary[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(c) => c.applicantPhone}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-2 p-4"
        onEndReached={() => query.hasNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <Stack gap="sm" className="pb-2">
            <Text variant="subtitle">{t("inbox.title")}</Text>
            <Input value={search} onChangeText={setSearch} placeholder={t("inbox.search")} />
            <Switch value={withApplication} onValueChange={setWithApplication} label={t("inbox.withApplication")} />
          </Stack>
        }
        ListEmptyComponent={
          query.isPending ? <Spinner label={t("common.loading")} /> : <Text tone="muted">{t("inbox.empty")}</Text>
        }
        renderItem={({ item }) => (
          <ListItem
            title={item.applicantPhoneMasked}
            subtitle={`${item.lastBody ?? `[${item.lastKind}]`} · ${item.messageCount} msg · ${item.zonePath ?? "—"}`}
            onPress={() => setThread(item)}
            trailing={
              item.applicationStatus ? (
                <Badge label={t(`inbox.status.${item.applicationStatus}` as Parameters<typeof t>[0])} tone={STATUS_TONE[item.applicationStatus] ?? "neutral"} />
              ) : (
                <Badge label={item.lastDirection === "INBOUND" ? t("inbox.in") : t("inbox.out")} tone="neutral" />
              )
            }
          />
        )}
      />
      <ThreadModal conversation={thread} onClose={() => setThread(null)} />
    </SafeAreaView>
  );
}

/** Hilo completo de una conversación con el cliente. */
function ThreadModal({
  conversation,
  onClose,
}: {
  conversation: ConversationSummary | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const query = useConversationThread(conversation?.applicantPhone ?? null);
  return (
    <Modal visible={conversation !== null} onClose={onClose} title={conversation?.applicantPhoneMasked ?? ""}>
      <Stack gap="xs" className="p-4">
        {query.isPending || !query.data ? (
          <Spinner label={t("common.loading")} />
        ) : query.data.entries.length === 0 ? (
          <Text tone="muted">{t("inbox.empty")}</Text>
        ) : (
          query.data.entries.map((e, i) => (
            <Row key={i} className={e.direction === "INBOUND" ? "justify-start" : "justify-end"}>
              <Text variant="caption" tone={e.direction === "INBOUND" ? "default" : "primary"}>
                {e.direction === "INBOUND" ? "← " : "→ "}
                {e.body ?? `[${e.kind}]`}
              </Text>
            </Row>
          ))
        )}
      </Stack>
    </Modal>
  );
}
