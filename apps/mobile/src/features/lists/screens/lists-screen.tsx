import { useState } from "react";
import { FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Badge,
  Banner,
  Button,
  ConfirmModal,
  Input,
  ListItem,
  Row,
  Spinner,
  Stack,
  Text,
  useToast,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import {
  useBorrowerLists,
  useCreateBorrowerList,
  useDeleteBorrowerList,
} from "../api/queries";

/** Lista cuya eliminación espera confirmación (nombre para que el aviso diga cuál). */
type PendingDelete = { id: string; name: string };

/** Listas personalizadas (segmentación): crear, ver con nº de miembros, eliminar. */
export function ListsScreen() {
  const { t, tf } = useT();
  const toast = useToast();
  const query = useBorrowerLists();
  const create = useCreateBorrowerList();
  const remove = useDeleteBorrowerList();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const submit = () => {
    setError(null);
    if (!name.trim()) {
      setError(t("errors.validation"));
      return;
    }
    create.mutate(name.trim(), {
      onSuccess: () => setName(""),
      onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  // Borrar solo tras confirmar; el aviso de error sale fuera del modal para que se vea.
  const confirmDelete = () => {
    if (!pendingDelete) return;
    remove.mutate(pendingDelete.id, {
      onSettled: () => setPendingDelete(null),
      onError: (err) =>
        toast.show({
          tone: "danger",
          title: isApiError(err) ? t(err.messageKey) : t("errors.unknown"),
        }),
    });
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={query.data?.items ?? []}
        keyExtractor={(l) => l.id}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-2 p-4"
        ListHeaderComponent={
          <Stack gap="sm" className="pb-2">
            <Text variant="subtitle">{t("lists.title")}</Text>
            {error ? <Banner tone="danger" title={error} /> : null}
            <Row className="gap-2">
              <Input value={name} onChangeText={setName} placeholder={t("lists.name")} className="flex-1" />
              <Button label={t("common.create")} size="sm" loading={create.isPending} onPress={submit} />
            </Row>
          </Stack>
        }
        ListEmptyComponent={
          query.isPending ? <Spinner label={t("common.loading")} /> : <Text tone="muted">{t("lists.empty")}</Text>
        }
        renderItem={({ item }) => (
          <ListItem
            title={item.name}
            subtitle={`${item.memberCount} ${t("lists.members")}`}
            trailing={
              <Row className="items-center gap-2">
                <Badge label={String(item.memberCount)} tone="neutral" />
                <Button
                  label={t("common.delete")}
                  variant="ghost"
                  size="sm"
                  onPress={() => setPendingDelete({ id: item.id, name: item.name })}
                />
              </Row>
            }
          />
        )}
      />
      <ConfirmModal
        visible={pendingDelete !== null}
        title={t("lists.delete.confirmTitle")}
        description={tf("lists.delete.confirmBody", { name: pendingDelete?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        tone="danger"
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </SafeAreaView>
  );
}
