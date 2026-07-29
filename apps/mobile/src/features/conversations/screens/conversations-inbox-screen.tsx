import { useCallback, useMemo, useState } from "react";
import { FlatList } from "react-native";
import { useRouter, type Href } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import type {
  ConversationFilters,
  ConversationOrder,
  ConversationSort,
  ConversationSummary,
  DeletionResult,
} from "@preztiaos/contracts";
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Modal,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import {
  useConversationStats,
  useConversationsList,
  useDeleteConversations,
  usePurgeConversations,
} from "../api/queries";
import { ConversationHistory } from "../components/conversation-history";
import { ConversationRow } from "../components/conversation-row";
import { ConversationStatsBar } from "../components/conversation-stats-bar";
import {
  ConversationFiltersPanel,
  EMPTY_DRAFT,
  type FiltersDraft,
} from "../components/conversation-filters-panel";
import {
  DeletionConfirmModal,
  type DeletionMode,
} from "../components/deletion-confirm-modal";
import { ALL_OUTCOMES, type OutcomeFilter } from "../components/outcome";

// Una fecha se envía solo cuando está completa: mientras el operador la teclea, el filtro no
// debe aplicarse a medias (ni el contrato aceptaría "2026-0").
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Traduce el borrador del formulario al criterio que entienden el listado y la purga. */
function toFilters(draft: FiltersDraft, outcome: OutcomeFilter): ConversationFilters {
  return {
    ...(draft.search.trim() ? { search: draft.search.trim() } : {}),
    ...(outcome === ALL_OUTCOMES ? {} : { outcome }),
    ...(draft.withApplication ? { withApplication: true } : {}),
    ...(draft.channelId.trim() ? { channelId: draft.channelId.trim() } : {}),
    ...(draft.zonePath ? { zonePath: draft.zonePath } : {}),
    ...(DATE_PATTERN.test(draft.from) ? { from: draft.from } : {}),
    ...(DATE_PATTERN.test(draft.to) ? { to: draft.to } : {}),
  };
}

/**
 * Consola de comunicaciones de WhatsApp (ADMIN del tenant y COORDINATOR de ruta, cada uno dentro
 * de su alcance de zonas). Responde a las tres preguntas de la operación sobre la cola:
 *
 *  - **Cuántos y en qué quedaron** → estadística por desenlace, que es a la vez el filtro.
 *  - **Qué se dijo exactamente** → hilo completo con los fallos técnicos intercalados.
 *  - **Qué ya no sirve** → depuración fila a fila, por lote o de todo lo filtrado.
 *
 * Ordena por defecto por fecha/hora de la comunicación, de la más reciente a la más antigua.
 */
export function ConversationsInboxScreen() {
  const { t } = useT();
  const router = useRouter();

  const [draft, setDraft] = useState<FiltersDraft>(EMPTY_DRAFT);
  const [outcome, setOutcome] = useState<OutcomeFilter>(ALL_OUTCOMES);
  const [sort, setSort] = useState<ConversationSort>("lastAt");
  const [order, setOrder] = useState<ConversationOrder>("desc");
  const [showFilters, setShowFilters] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [thread, setThread] = useState<ConversationSummary | null>(null);
  const [confirming, setConfirming] = useState<DeletionMode | null>(null);
  const [result, setResult] = useState<DeletionResult | null>(null);

  const filters = useMemo(() => toFilters(draft, outcome), [draft, outcome]);
  const list = useConversationsList(filters, { sort, order });
  const stats = useConversationStats(filters);
  const remove = useDeleteConversations();
  const purge = usePurgeConversations();

  const items = useMemo<ConversationSummary[]>(
    () => list.data?.pages.flatMap((p) => p.items) ?? [],
    [list.data],
  );
  // Las conversaciones de créditos aprobados no se ofrecen para borrar: el servidor las
  // rechaza igualmente, pero marcarlas aquí evita prometer algo que no va a ocurrir.
  const deletable = useMemo(() => items.filter((i) => !i.protected), [items]);

  const toggle = useCallback((phone: string) => {
    setSelection((current) =>
      current.includes(phone)
        ? current.filter((p) => p !== phone)
        : [...current, phone],
    );
  }, []);

  const exitSelection = useCallback(() => {
    setSelecting(false);
    setSelection([]);
  }, []);

  const pending = remove.isPending || purge.isPending;
  const failure = remove.error ?? purge.error;

  const confirmDeletion = async () => {
    const outcomeOfRun =
      confirming === "purge"
        ? await purge.mutateAsync(filters)
        : await remove.mutateAsync([...selection]);
    setResult(outcomeOfRun);
    setConfirming(null);
    exitSelection();
  };

  if (list.isError) {
    return (
      <ErrorState
        title={t("inbox.title")}
        description={t("errors.network")}
        onRetry={() => list.refetch()}
      />
    );
  }

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(c) => c.applicantPhone}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-2 p-4"
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <Stack gap="md" className="pb-2">
            <Row className="justify-between">
              <Text variant="subtitle">{t("inbox.title")}</Text>
              <Button
                label={t("inbox.filters.title")}
                variant="ghost"
                size="sm"
                onPress={() => setShowFilters((v) => !v)}
              />
            </Row>

            {result ? (
              <Banner
                tone="success"
                title={`${t("inbox.deleted")}: ${result.deletedConversations}`}
                description={
                  result.skippedProtected > 0
                    ? `${result.skippedProtected} ${t("inbox.skippedProtected")}`
                    : `${result.deletedMessages} msg · ${result.deletedFailures} ⚠`
                }
              />
            ) : null}

            {showFilters ? (
              <ConversationFiltersPanel
                draft={draft}
                onChange={setDraft}
                sort={sort}
                order={order}
                onSortChange={setSort}
                onOrderChange={setOrder}
              />
            ) : null}

            <ConversationStatsBar
              stats={stats.data}
              loading={stats.isPending}
              selected={outcome}
              onSelect={(next) => {
                setOutcome(next);
                exitSelection();
              }}
            />

            <SelectionBar
              selecting={selecting}
              selectedCount={selection.length}
              deletableCount={deletable.length}
              onStart={() => setSelecting(true)}
              onCancel={exitSelection}
              onSelectAll={() => setSelection(deletable.map((i) => i.applicantPhone))}
              onDelete={() => setConfirming("selection")}
              onPurge={() => setConfirming("purge")}
            />
          </Stack>
        }
        ListEmptyComponent={
          list.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : (
            <EmptyState title={t("inbox.empty")} />
          )
        }
        renderItem={({ item }) => (
          <ConversationRow
            item={item}
            selectable={selecting}
            selected={selection.includes(item.applicantPhone)}
            onToggle={() => toggle(item.applicantPhone)}
            onOpen={() => setThread(item)}
          />
        )}
        ListFooterComponent={list.isFetchingNextPage ? <Spinner /> : null}
      />

      <ThreadModal
        conversation={thread}
        onClose={() => setThread(null)}
        onOpenApplication={(id) => {
          setThread(null);
          router.push(`/applications/${id}` as Href);
        }}
      />

      <DeletionConfirmModal
        mode={confirming}
        count={selection.length}
        pending={pending}
        error={failure ? t("errors.network") : null}
        onConfirm={() => void confirmDeletion()}
        onClose={() => setConfirming(null)}
      />
    </SafeAreaView>
  );
}

/** Barra de acciones de depuración. Fuera del modo selección solo ofrece entrar en él. */
function SelectionBar({
  selecting,
  selectedCount,
  deletableCount,
  onStart,
  onCancel,
  onSelectAll,
  onDelete,
  onPurge,
}: {
  selecting: boolean;
  selectedCount: number;
  deletableCount: number;
  onStart: () => void;
  onCancel: () => void;
  onSelectAll: () => void;
  onDelete: () => void;
  onPurge: () => void;
}) {
  const { t } = useT();

  if (!selecting) {
    return (
      <Row gap="sm" className="flex-wrap">
        <Button label={t("inbox.select")} variant="secondary" size="sm" onPress={onStart} />
        <Button label={t("inbox.purge")} variant="danger" size="sm" onPress={onPurge} />
      </Row>
    );
  }

  return (
    <Stack gap="sm">
      <Row gap="sm" className="flex-wrap">
        <Button
          label={t("inbox.selectAll")}
          variant="secondary"
          size="sm"
          disabled={deletableCount === 0}
          onPress={onSelectAll}
        />
        <Button label={t("inbox.selectDone")} variant="ghost" size="sm" onPress={onCancel} />
      </Row>
      <Button
        label={`${t("inbox.delete")} (${selectedCount})`}
        variant="danger"
        block
        disabled={selectedCount === 0}
        onPress={onDelete}
      />
    </Stack>
  );
}

/** Hilo completo de una conversación, con acceso directo al expediente si lo hay. */
function ThreadModal({
  conversation,
  onClose,
  onOpenApplication,
}: {
  conversation: ConversationSummary | null;
  onClose: () => void;
  onOpenApplication: (applicationId: string) => void;
}) {
  const { t } = useT();
  return (
    <Modal
      visible={conversation !== null}
      onClose={onClose}
      title={conversation?.applicantPhoneMasked ?? ""}
    >
      <Stack gap="md" className="p-4">
        {conversation?.applicationId ? (
          <Button
            label={t("inbox.thread.openApplication")}
            variant="secondary"
            size="sm"
            onPress={() => onOpenApplication(conversation.applicationId as string)}
          />
        ) : null}
        <ConversationHistory phone={conversation?.applicantPhone ?? null} />
      </Stack>
    </Modal>
  );
}
