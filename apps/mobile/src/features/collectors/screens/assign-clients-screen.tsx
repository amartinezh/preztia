import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { AssignableClient } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  EmptyState,
  ListItem,
  Row,
  Spinner,
  Switch,
  Text,
  useToast,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useAssignableClients } from "@/features/clients/api/queries";
import { useUpdateCollectorClients } from "../api/queries";

/** Lo que la persona cambió respecto a la cartera actual: a quién marcó y a quién desmarcó. */
type Deltas = { add: string[]; remove: string[] };

/**
 * Coordinador: selecciona, de entre los clientes de su alcance, los que gestionará un cobrador.
 * La selección efectiva = override explícito del usuario ?? estado `assigned` que trae el backend
 * (sin `useEffect`: se deriva en render). Al guardar se envían SOLO los cambios explícitos
 * (`add`/`remove`): los clientes de páginas no cargadas no se tocan (antes se desasignaban en
 * silencio al reemplazar la cartera con lo cargado).
 */
export function AssignClientsScreen({ collectorId }: { collectorId: string }) {
  const { t, tf } = useT();
  const router = useRouter();
  const toast = useToast();
  const query = useAssignableClients(collectorId);
  const save = useUpdateCollectorClients(collectorId);
  // Solo los cambios EXPLÍCITOS del usuario; lo demás cae al `assigned` del backend.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const items = useMemo<AssignableClient[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  // Un override igual al estado del servidor no es un cambio (marcar y desmarcar se anulan).
  const deltas = useMemo<Deltas>(() => computeDeltas(items, overrides), [items, overrides]);
  const hasChanges = deltas.add.length > 0 || deltas.remove.length > 0;

  if (query.isPending) return <Spinner label={t("common.loading")} />;

  const isSelected = (client: AssignableClient) =>
    overrides[client.borrowerId] ?? client.assigned;

  const toggle = (borrowerId: string, value: boolean) =>
    setOverrides((prev) => ({ ...prev, [borrowerId]: value }));

  const submit = () => {
    if (!hasChanges) return;
    setError(null);
    save.mutate(deltas, {
      onSuccess: ({ assigned }) => {
        setOverrides({});
        toast.show({ tone: "success", title: tf("collectors.assign.saved", { n: assigned }) });
        router.back();
      },
      onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(c) => c.borrowerId}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-2 p-4"
        ListHeaderComponent={
          <Row className="justify-between pb-2">
            <Text variant="subtitle">{t("collectors.assign.title")}</Text>
            <Text variant="caption" tone={hasChanges ? "primary" : "muted"}>
              {hasChanges
                ? tf("collectors.assign.delta", { added: deltas.add.length, removed: deltas.remove.length })
                : t("collectors.assign.noChanges")}
            </Text>
          </Row>
        }
        ListEmptyComponent={<EmptyState title={t("collectors.assign.empty")} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => query.hasNextPage && query.fetchNextPage()}
        ListFooterComponent={query.isFetchingNextPage ? <Spinner /> : null}
        renderItem={({ item }) => (
          <ListItem
            title={item.name ?? `Cliente ${item.borrowerId.slice(0, 8)}`}
            subtitle={item.phone ?? item.zonePath ?? item.borrowerId.slice(0, 8)}
            trailing={
              <Switch
                value={isSelected(item)}
                onValueChange={(v) => toggle(item.borrowerId, v)}
              />
            }
          />
        )}
      />
      <View className="mx-auto w-full max-w-[880px] gap-2 p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Button
          label={t("collectors.assign.submit")}
          loading={save.isPending}
          disabled={!hasChanges}
          block
          onPress={submit}
        />
      </View>
    </SafeAreaView>
  );
}

/** Deltas = overrides que difieren del `assigned` del servidor, separados en añadir / quitar. */
function computeDeltas(items: AssignableClient[], overrides: Record<string, boolean>): Deltas {
  const assignedById = new Map(items.map((c) => [c.borrowerId, c.assigned] as const));
  const add: string[] = [];
  const remove: string[] = [];
  for (const [borrowerId, selected] of Object.entries(overrides)) {
    const assigned = assignedById.get(borrowerId);
    if (assigned === undefined || assigned === selected) continue;
    (selected ? add : remove).push(borrowerId);
  }
  return { add, remove };
}
