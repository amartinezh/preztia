import { useState } from "react";
import { FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Badge, Banner, Button, Input, ListItem, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import {
  useBorrowerLists,
  useCreateBorrowerList,
  useDeleteBorrowerList,
} from "../api/queries";

/** Listas personalizadas (segmentación): crear, ver con nº de miembros, eliminar. */
export function ListsScreen() {
  const { t } = useT();
  const query = useBorrowerLists();
  const create = useCreateBorrowerList();
  const remove = useDeleteBorrowerList();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

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
                <Button label={t("common.delete")} variant="ghost" size="sm" onPress={() => remove.mutate(item.id)} />
              </Row>
            }
          />
        )}
      />
    </SafeAreaView>
  );
}
